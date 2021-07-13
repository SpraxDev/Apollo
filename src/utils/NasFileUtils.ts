import sharp from 'sharp';
import { HttpError } from './HttpError';
import { NasUtils } from './NasUtils';
import { VideoUtils } from './VideoUtils';

export type ThumbnailData = { mime: string, data: Buffer };

export class NasFileUtils {
  private static readonly sharpTypes = [
    'application/pdf', 'image/bmp', 'image/gif', 'image/jpeg',
    'image/png', 'image/svg+xml', 'image/tiff', 'image/webp'
  ];

  static async generateThumbnail(absPath: string, size: number): Promise<ThumbnailData | null> {
    const file = await NasUtils.fetchFile(absPath);

    if (file.mime) {
      if (this.sharpTypes.includes(file.mime)) {
        const pngBuffer = await sharp(absPath, {
          failOnError: false,
          sequentialRead: true,
          density: 500
        })
            .on('error', (err) => {
              throw new HttpError(`Invalid or corrupted file: ${err.message}`, 400);
            })
            .resize(size, size, {
              // fit: 'cover',
              // position: 'attention',
              fit: 'inside',
              fastShrinkOnLoad: true,
              withoutEnlargement: true
            })
            .png()
            .toBuffer();

        return {mime: 'image/png', data: pngBuffer};
      } else if (file.mime.startsWith('video/')) {
        const thumbnail = await VideoUtils.extractVideoThumbnail(absPath);

        const pngBuffer = await thumbnail.img
            /*.resize(size, size, {
              fit: 'inside',
              fastShrinkOnLoad: true,
              withoutEnlargement: true
            })*/
            .png()
            .toBuffer();

        thumbnail.done();

        return {mime: 'image/png', data: pngBuffer};
      }
    }

    throw new HttpError('Unsupported Media Type', 415);
  }
}
