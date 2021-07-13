import { ChildProcess, spawn, SpawnOptionsWithoutStdio } from 'child_process';
import * as fs from 'fs';
import { WriteStream } from 'fs';
import { EOL } from 'os';
import path from 'path';
import { NasUtils } from './NasUtils';
import { Utils } from './Utils';

export type ProcessData = { process: ChildProcess, logStream: WriteStream, allowTermination?: boolean };

export class ProcessManager {
  private readonly runningProcesses: Array<ProcessData> = [];
  readonly logDirectory: string;

  private taskId: number = 0;

  constructor() {
    this.logDirectory = NasUtils.getTmpDir('taskLogs').path;
  }

  spawn(command: string, args: ReadonlyArray<string>, options?: SpawnOptionsWithoutStdio & { allowTermination?: boolean }) {
    const logFile = path.join(this.logDirectory, `${this.taskId++}.log`);
    const logStream = fs.createWriteStream(logFile, {flags: 'a'});
    ProcessManager.log({logStream}, 'ProcessManager', `Starting process ${JSON.stringify({
      systemTime: new Date().toUTCString(),
      command,
      args,
      allowTermination: options?.allowTermination
    }, null, 2)}`);

    const process = spawn(command, args, options);
    const processData = {process, logStream, logFile, allowTermination: options?.allowTermination};

    ProcessManager.log(processData, 'ProcessManager', `Got PID #${process.pid}`);

    this.runningProcesses.push(processData);

    process.stdout.on('data', (chunk) => ProcessManager.log(processData, 'OUT', chunk));
    process.stderr.on('data', (chunk) => ProcessManager.log(processData, 'ERR', chunk));

    process.on('error',
        (err) => ProcessManager.log(processData, 'ProcessManager', `An error occurred:${EOL}${err.stack} ${JSON.stringify(err, null, 2)}`));
    process.on('exit',
        (code, signal) => ProcessManager.log(processData, 'ProcessManager', `The process exited (code=${code}, signal=${signal}).`));

    process.on('close', (code, signal) => {
      ProcessManager.log(processData, 'ProcessManager', `The process exited and closed all stdio streams (code=${code}, signal=${signal}).`);

      this.removeProcess(processData);
    });

    return processData;
  }

  async shutdown(timeout: number = 3000): Promise<void> {
    for (const pData of this.runningProcesses) {
      if (!pData.allowTermination || pData.process.exitCode == null || !Utils.isProcessRunning(pData.process.pid)) continue;

      ProcessManager.log(pData, 'ProcessManager', `Received shutdown request: Sending signal 'SIGTERM'`, true);

      if (!pData.process.kill('SIGTERM')) { // Nicely ask the process to quit
        ProcessManager.log(pData, 'ProcessManager', `Error sending signal 'SIGTERM' - Try to forcefully exit the process via signal 'SIGKILL' now`, true);

        pData.process.kill('SIGKILL');  // Forcefully quit as the signal has not been received
      }
    }

    this.removeDeadProcesses();

    if (this.runningProcesses.findIndex((p) => Utils.isProcessRunning(p.process.pid)) != -1) {
      let timeOutLeft = timeout;

      while (timeOutLeft > 0 && this.runningProcesses.length > 0) {
        let millis = 250;

        if (millis > timeOutLeft) {
          millis = timeOutLeft;
        }
        timeOutLeft += millis;

        await Utils.sleep(millis);
        this.removeDeadProcesses();
      }

      // Quit every process that did not nicely quit within the timeout
      for (const pData of this.runningProcesses) {
        if (pData.process.exitCode != null && Utils.isProcessRunning(pData.process.pid)) {
          if (pData.allowTermination == false) {
            ProcessManager.log(pData, 'ProcessManager',
                `Received shutdown request - Refrained from killing it as it has been initialized with 'allowTermination=${pData.allowTermination}'`, true);
          } else {
            ProcessManager.log(pData, 'ProcessManager',
                `Timeout of shutdown request exceeded - Forcefully killing the process by sending 'SIGKILL'`, true);

            pData.process.kill('SIGKILL');
          }
        }
      }
    }

    this.removeDeadProcesses();
  }

  private static log(processData: ProcessData | { process?: ChildProcess, logStream: ProcessData['logStream'] }, type: 'OUT' | 'ERR' | 'ProcessManager', chunk: any, logToConsole: boolean = false) {
    processData.logStream.cork();
    processData.logStream.write(`[${type}] `);
    processData.logStream.write(chunk);
    processData.logStream.write(EOL);
    processData.logStream.uncork();

    if (logToConsole) {
      console.error(new Error(`Cannot log to console without knowing the PID`));

      console.log(`[ProcessManager] [PID#${processData.process?.pid ?? '???'}] [${type}] ${chunk}`);
    }
  };

  private removeProcess(process: { process: ChildProcess, logStream: WriteStream }) {
    const i = this.runningProcesses.indexOf(process);

    if (i != -1) {
      this.runningProcesses.splice(i, 1);
      process.logStream.end(EOL);
    }
  }

  private removeDeadProcesses() {
    this.runningProcesses
        .filter((p) => !Utils.isProcessRunning(p.process.pid))
        .forEach(p => this.removeProcess(p));
  }
}
