import { spawn } from 'child_process';
import ffMpegPath from 'ffmpeg-static';
import ffProbe from 'ffprobe';
import { path as ffProbePath } from 'ffprobe-static';
import fs from 'fs';
import { lookup } from 'mime-types';
import { tmpdir } from 'os';
import path from 'path';
import sharp, { Sharp } from 'sharp';
import { promisify } from 'util';
import { NasUser } from '../global';
import { WORKING_DIR } from '../index';

const fsStat = promisify(fs.stat);
const fsOpenDir = promisify(fs.opendir);
const fsMkdtemp = promisify(fs.mkdtemp);
const fsMkdir = promisify(fs.mkdir);
const fsRm = promisify(fs.rm);

/*
1080p (12M)
1080p (10M)
1080p (8M)
720p (4M)
720p (3M)
720p (2M)
480p (1.5M)
 */

export class NasUtils {
  static readonly TMP_DIR = path.resolve(path.join(tmpdir(), 'NASWeb', '/'));

  static readonly EXCLUDED_EXIF_KEYS = [
    'Directory', 'ExifToolVersion', 'FileAccessDate', 'FileInodeChangeDate', 'FileModifyDate', 'FileName',
    'FilePermissions', 'FileType', 'FileTypeExtension', 'MIMEType', 'FileSize', 'SourceFile'
  ];

  static async getTmpDir(type: 'thumbnails' | 'live'): Promise<{ path: string, done: () => void }> {
    const taskDir = path.join(this.TMP_DIR, type, '/');

    await fsMkdir(taskDir, {recursive: true});

    return {
      path: await fsMkdtemp(taskDir),
      done: () => {
        fsRm(taskDir, {recursive: true});
      }
    };
  }

  static async moveFileGracefully(srcPath: string, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!path.isAbsolute(srcPath) || !path.isAbsolute(targetPath)) return reject(new Error('Paths need to be absolute'));

      const process = spawn('mv', ['-b', srcPath, `--target-directory=${path.dirname(targetPath)}`]);
      process.on('error', (err) => reject(err));

      let outBuff = '';
      let errBuff = '';

      process.stdout.on('data', (chunk) => {
        outBuff += chunk.toString();
      });
      process.stderr.on('data', (chunk) => {
        errBuff += chunk.toString();
      });

      process.on('close', (code) => {
        if (code != 0) {
          return reject(new Error(`Executing command 'mv' exited with code ${code} (stderr='${errBuff}',stdout='${outBuff}')`));
        }

        resolve();
      });
    });
  }

  /**
   * Settings `contentAware` to `true` generally produces higher quality thumbnails (e.g. less black ones)
   * but can drastically increase execution time depending on the input
   */
  static async extractVideoThumbnail(absPath: string, contentAware?: boolean): Promise<{ img: Sharp, done: () => void }> {
    return new Promise(async (resolve, reject): Promise<void> => {
      if (!path.isAbsolute(absPath)) return reject(new Error('Path need to be absolute'));

      const videoMeta = await ffProbe(absPath, {path: ffProbePath});

      let videoDuration = 0;

      for (const stream of videoMeta.streams) {
        if (stream.codec_type == 'video' && stream.duration != undefined) {
          videoDuration = parseInt(stream.duration + '', 10);
          break;
        }
      }

      const cwd = await this.getTmpDir('thumbnails');
      const args = ['-i', absPath];

      if (contentAware) {
        args.unshift('-ss', ((1 - 0.75) * videoDuration).toString());
        args.push('-vf', `select='eq(pict_type\\,I)'`);
      } else {
        args.push('-vf', `select='gt(scene\\,0.3)'`);
      }
      args.push('-vframes', '1', 'thumbnail.png');

      const process = spawn(ffMpegPath, args,
          {cwd: cwd.path});
      process.on('error', (err) => reject(err));

      let outBuff = '';
      let errBuff = '';

      process.stdout.on('data', (chunk) => {
        outBuff += chunk.toString();
      });
      process.stderr.on('data', (chunk) => {
        errBuff += chunk.toString();
      });

      process.on('close', (code) => {
        if (code != 0) {
          return reject(new Error(`Executing command 'ffmpeg' exited with code ${code} (stderr='${errBuff}',stdout='${outBuff}')`));
        }

        resolve({img: sharp(path.join(cwd.path, 'thumbnail.png'), {sequentialRead: true}), done: cwd.done});
      });
    });
  }

  static getRequestedPath(user: NasUser, type: 'data' | 'trash' | 'tmp', reqPath: string): string {
    const usrDir = this.getUserNasDir(user.id);
    const result = path.normalize(path.join(usrDir, type, reqPath));

    if (!result.startsWith(usrDir)) {
      throw new Error(`That user (id=${user.id}, name='${user.name}') is not allowed at '${result}' (reqPath='${reqPath}')`);
    }

    return result;
  }

  static async fetchDirectory(absPath: string):
      Promise<{ directories: Array<{ name: string }>, files: Array<{ name: string, modifyDate: Date }> }> {
    if (!path.isAbsolute(absPath)) throw new Error('The provided path needs to be absolute');

    const stat = await fsStat(absPath);

    if (!stat.isDirectory()) throw new Error('The provided path is not a directory');

    const directories = [];
    const files = [];


    const dir = await fsOpenDir(absPath);

    try {
      let file;
      while (file = dir.readSync()) {
        if (file.isDirectory()) {
          directories.push({
            name: file.name
          });
        } else if (file.isFile()) {
          files.push({
            name: file.name,
            modifyDate: stat.mtime
          });
        }
      }
    } finally {
      await dir.close();
    }

    return {directories, files};
  }

  static async fetchFile(absPath: string):
      Promise<{ mime: string | null, sizeInByte: number, lastModified: Date, creationTime: Date }> {
    if (!path.isAbsolute(absPath)) throw new Error('The provided path needs to be absolute');

    const stat = await fsStat(absPath);

    if (!stat.isFile()) throw new Error('The provided path is not a file');


    const type = stat.size > 0 ? await this.getFileType(absPath) : null;

    return {
      mime: type ?? null,
      sizeInByte: stat.size,
      lastModified: stat.mtime,
      creationTime: stat.birthtime
    };
  }

  static async getFileType(absPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('file', ['--mime-type', absPath], {timeout: 3000});
      process.on('error', (err) => reject(err));

      let outBuff = '';
      let errBuff = '';

      process.stdout.on('data', (chunk) => {
        outBuff += chunk.toString();
      });
      process.stderr.on('data', (chunk) => {
        errBuff += chunk.toString();
      });

      process.on('close', (code) => {
        if (code != 0) {
          return reject(new Error(`Executing command 'file' exited with code ${code} (stderr='${errBuff}',stdout='${outBuff}')`));
        }

        let type = outBuff.substring(outBuff.lastIndexOf(':') + 1).trim();

        if (type == 'application/octet-stream') {
          const typeByExt = lookup(path.extname(absPath).toLowerCase());

          if (typeByExt) {
            type = typeByExt;
          }
        }

        resolve(type);
      });
    });
  }

  static async getExifToolData(absPath: string, filtered: boolean = true): Promise<{ [key: string]: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn('exiftool', ['-json', '-sort', '--composite', '-unknown', '-d', '%d. %b. %Y %H:%M:%S %Z', absPath], {timeout: 3000});
      process.on('error', (err) => reject(err));

      let outBuff = '';
      let errBuff = '';

      process.stdout.on('data', (chunk) => {
        outBuff += chunk.toString();
      });
      process.stderr.on('data', (chunk) => {
        errBuff += chunk.toString();
      });

      process.on('close', (code) => {
        if (code != 0) {
          if (outBuff.indexOf('"Error": "File is empty"') != -1) {
            return resolve({});
          }

          return reject(new Error(`Executing command 'exiftool' exited with code ${code} (stderr='${errBuff}',stdout='${outBuff}')`));
        }
        const data = JSON.parse(outBuff);

        if (!Array.isArray(data) || data.length != 1) {
          reject(new Error(`exiftool returned invalid or no data - Keep in mind that directories are currently not supported by the API`));
        }

        if (filtered) {
          const result: { [key: string]: string } = {};

          for (const metaKey in data[0]) {
            if (data[0].hasOwnProperty(metaKey)) {

              if (!this.EXCLUDED_EXIF_KEYS.includes(metaKey)) {
                const metaValue = data[0][metaKey];

                result[metaKey] = metaValue.toString();
              }
            }
          }

          resolve(result);
        } else {
          resolve(data[0]);
        }
      });
    });
  }

  /**
   * Only `null` if the file does not exist
   *
   * @param absPath The absolute path to check
   */
  static isDirectory(absPath: string): boolean | null {
    if (!fs.existsSync(absPath)) return null;

    return fs.statSync(absPath).isDirectory();
  }

  private static getUserNasDir(userId: NasUser['id']): string {
    return path.join(WORKING_DIR, userId.toString(), '/');
  }
}
