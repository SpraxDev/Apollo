export class NasPath {
  /** The absolute path on the file system */
  // readonly absPath: string;

  /** The relative path from the user's directory e.g. `data/documents/file.txt` */
  // readonly relPath: string;

  // TODO: Wird anstelle der Pfades immer Übergeben und hat Methoden um die bisher benötigten Pfade bisher richtig und einheitlich zu formatieren
}

export class Cache {
  // TODO: Jeder user hat eigenen cache und der key ist dann irwie `${sha256(relPath)}${file.lastModified}`
  //       Elemente im Cache können eine TTL haben und der Cache wird regelmäßig invalidiert (Monatlich? Ungültige Elemente löschen halt)
  //       Die Dateien im Cache sind hardcoded (die erlaubt sind), z.B. thumbnail@500.png
}
