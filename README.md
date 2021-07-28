# NAS-Web

## Bugs

* Videos ohne Videospur werfen fehler beim Thumbnail generieren

## ToDo

* File-Browser
    * [x] Mit Down- und Upload
    * [x] FileTypes werden am content ausgemacht und nicht an der File-Extension
    * Datei kann auf Viren geprüft werden
        * (optional) automatischer abgleich mit VirusTotal
    * File-Preview
        * File-Hash kann für verschiedene Algorithmen generiert werden
            * Mit Feld zum Vergleichen mit bekanntem Hash
            * Für Zip-Files und jar-Files können einen Content-Hash generiert werden
              (Die Reihenfolge und Kompressionsstufe kann einen Hash beeinflussen was nicht immer gewünscht ist)
        * Previews werden für Media-Files im Vorfeld angelegt
            * Bilder
                * [x] low-res thumbnail
                * an optimized version with full-res preview (button für original Qualität)
            * Videos
                * Werden in mehrere Formate gewandelt um besser gestreamt werden zu können
                    * Der in-browser Player supportet embedded subtitles
* Dateien können im Webinterface „bearbeitet“ werden
    * Extract Zip-Archives
    * Convert Videos into a specific format/resolution/...
* User and Permission based
    * Ordner und Dateien, auf die man Zugriff bekommen hat, findet man in einem extra Menü-Punkt
        * Es ist möglich eine Verlinkung auf diese in die eigenen Ordner zu laden
* Virtuelle FIleSystems mounten können (WebDAV, SSH, GDrive, ...)
* OAuth
  * Atlassian
  * GitLab
  * Discord
