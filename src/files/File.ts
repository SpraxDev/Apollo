import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import objectAssignDeep from 'object-assign-deep';
import { dirname, join as joinPath } from 'path';

export abstract class File {
    private readonly path: string;

    protected constructor(path: string) {
        this.path = path;
    }

    protected abstract getData(): object;

    protected abstract getDefaults(): object;

    save() {
        writeFileSync(this.path, JSON.stringify(this.getData(), null, 4));
    }

    load(): object {
        // Create directory if it does not exist
        if (!existsSync(dirname(this.path))) {
            mkdirSync(dirname(this.path), {recursive: true});
        }

        // Parse file at give path and merge with the default data
        return objectAssignDeep({}, this.getDefaults(), existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf-8')) : {});
    }

    static getPath(fileName: string): string {
        return joinPath(process.cwd(), 'storage', fileName);
    }
}