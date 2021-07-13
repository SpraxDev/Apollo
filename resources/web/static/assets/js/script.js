'use strict';

// FIXME: Kinda hacky way to temporarily fix Double-Click on mobile
const userAgentHasTouchScreen = () => 'ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

const notifier = new AWN({
  icons: false,
  durations: {
    alert: 0, warning: 0
  },
  labels: {
    tip: 'Tipp',
    success: 'Erfolgreich',
    warning: 'Warnung'
  }
});

/* Setup */

window.addEventListener('load', () => {
  onLoadAsync()
      .catch(console.error);
});

document.addEventListener('DOMContentLoaded', () => {
  // Show elements that should only be visible when JS is enabled
  document.querySelectorAll('[data-jsOnly]')
      .forEach((elem) => {
        elem.classList.remove('d-none');
      });
});

let modalElem, modal, modalTooltips = [];

/**
 * @param {'mkdir' | 'ffmpeg'} type
 * @param {any} data
 */
function prepareModal(type, data) {
  for (const tooltip of modalTooltips) {
    tooltip.dispose();
  }
  modalTooltips.splice(0);  // Clear array

  if (type === 'mkdir') {
    document.getElementById('ModalTitle').innerText = 'Verzeichnis erstellen';

    modalElem.querySelector('.modal-body').innerHTML =
        `<form class="row" method="post" onsubmit="mkdirDialog(event)">
           <div class="col">
             <!--   <span class="input-group-text">/curr/path/.../</span>-->
             <input type="text" class="form-control" aria-label="Name of the directory to create"
                    required autofocus autocomplete="off" oninput="mkdirDialog(event)">
             <div class="invalid-feedback"></div>
           </div>
  
           <div class="col-auto">
             <button class="btn btn-primary" type="submit">Erstellen</button>
           </div>
        </form>

        <div class="alert alert-info d-none" role="alert"></div>`;
  } else if (type === 'ffmpeg') {
    document.getElementById('ModalTitle').innerText = 'Gefundene Streams';

    let modalHtml = '';

    const pendingTooltips = [];

    if (data) {
      modalHtml += '<form method="post">';

      for (const dataKey in data.streams) {
        if (data.streams.hasOwnProperty(dataKey)) {
          const streamArray = data.streams[dataKey];

          modalHtml += `<strong>${dataKey.charAt(0).toUpperCase() + dataKey.substring(1)}</strong>`;
          for (const s of streamArray) {
            let tooltipHtml = `<b><u>Stream #${s.id}</u></b><br><br>`;

            if (s.meta) {
              tooltipHtml += `<b><u>Meta</u></b><br>`;

              for (const tagKey in s.meta) {
                if (s.meta.hasOwnProperty(tagKey)) {
                  const tagValue = s.meta[tagKey];

                  tooltipHtml += `<b>${sanitizeHtmlTags(tagKey)}</b>: ${sanitizeHtmlTags(tagValue)}<br>`;
                }
              }

              tooltipHtml = tooltipHtml.replace(/"/g, '\\"');
            }

            let streamLang, streamTitle = `Stream #${s.id}`;

            if (s.tags) {
              if (!tooltipHtml.trimEnd().endsWith('<br>')) {
                tooltipHtml += '<br><br>';
              }

              tooltipHtml += `<b><u>Tags</u></b><br>`;

              for (const tagKey in s.tags) {
                if (s.tags.hasOwnProperty(tagKey)) {
                  const tagValue = s.tags[tagKey];

                  if (tagValue) {
                    if (tagKey === 'language') {
                      streamLang = tagValue;
                      continue;
                    } else if (tagKey === 'title') {
                      streamTitle = tagValue;
                      continue;
                    } else if (tagKey === 'filename' && !s.tags['title']) {
                      streamTitle = `<b>Attachment</b>: <em>${s.tags['filename']}</em>`;
                      continue;
                    }
                  }

                  tooltipHtml += `<b>${sanitizeHtmlTags(tagKey)}</b>: ${sanitizeHtmlTags(tagValue)}<br>`;
                }
              }

              if (dataKey === 'video') {
                streamTitle += ` (${s.width}x${s.height})`;
              }

              tooltipHtml = tooltipHtml.replace(/"/g, '\\"');
            }

            modalHtml += `<div class="form-check">
                            <input class="form-check-input" type="checkbox" value="" id="modalBody_stream_${s.id}" ${dataKey === 'unsupported' ? 'disabled' : ''}>
                            <label class="form-check-label" for="modalBody_stream_${s.id}" id="modalBody_stream_${s.id}_label"
                                   data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="right">
                              ${streamTitle}${streamLang ? ` (${streamLang})` : ''}
                            </label>
                          </div>`;

            if (dataKey === 'subtitle') {
              modalHtml += `<div class="form-check form-switch">
                              <input class="form-check-input" type="checkbox" id="modalBody_stream_${s.id}_hardSub">
                              <label class="form-check-label" for="modalBody_stream_${s.id}_hardSub">HardSub</label>
                            </div>
                            <br>`;
            }

            pendingTooltips.push({id: `modalBody_stream_${s.id}_label`, title: tooltipHtml});
          }

          if (!modalHtml.trimEnd().endsWith('<br>')) {
            modalHtml += '<br>';
          }
        }
      }

      modalHtml += '<hr>';
      modalHtml += '<button class="btn btn-primary" type="send">Send</button>';

      modalHtml += '</form>';
    }

    modalElem.querySelector('.modal-body').innerHTML = modalHtml;
    modalElem.querySelector('.modal-body form').onsubmit = (e) => {
      e.preventDefault();

      const options = {};

      modalElem.querySelector('.modal-body form')
          .querySelectorAll('input')
          .forEach((inputElem) => {
            const key = inputElem.id.substring(inputElem.id.indexOf('_', inputElem.id.indexOf('_') + 1) + 1);
            const value = inputElem.type === 'checkbox' ? inputElem.checked : inputElem.value;

            if (value !== false) {
              options[key] = value;
            }
          });

      fetch(data.fileURI, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({action: 'ffmpeg', options})
      })
          .then(httpRes => {
            if (httpRes.status === 200) {
              return httpRes.json();
            } else {
              throw new Error(`Server returned status ${httpRes.status}`);
            }
          })
          .then(body => {
            console.log('ffmpeg result:', body);

            if (body.message) {
              notifier.warning(body.message);
            }

            reloadFileTable();
          })
          .catch(err => {
            notifier.alert(`Beim Erstellen des Verzeichnisses ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
            console.error('Error while creating a directory:', err);
          })
          .finally(() => {
            modal.hide();
            // TODO: disable and un-disable the 'New' button
          });
    };

    for (const tooltip of pendingTooltips) {
      modalTooltips.push(new bootstrap.Tooltip(document.getElementById(tooltip.id), {title: tooltip.title}));
    }
  } else {
    throw new Error('Unknown modal type');
  }
}

async function onLoadAsync() {
  /* Setup upload button */
  const uploadForm = document.getElementById('uploadForm');
  uploadForm.addEventListener('click', (e) => {
    e.preventDefault();

    if (uploadForm.disabled) return;

    const tmpInput = document.createElement('input');
    tmpInput.type = 'file';
    tmpInput.multiple = true;

    tmpInput.addEventListener('change', () => {
      uploadForm.disabled = true;
      const buttons = uploadForm.querySelectorAll('button[type="submit"]');
      buttons.forEach((btn) => btn.disabled = true);

      const formData = new FormData();

      for (let i = 0; i < tmpInput.files.length; ++i) {
        // noinspection JSCheckFunctionSignatures
        formData.append('fUpload', tmpInput.files[i]);
      }

      fetch(location.pathname, {
        method: 'POST',
        headers: {
          Accept: 'application/json'
        },
        body: formData
      })
          .then(httpRes => {
            if (httpRes.status === 200) {
              return httpRes.json();
            } else {
              throw new Error(`Server returned status ${httpRes.status}`);
            }
          })
          .then(body => {
            console.log('Upload result:', body);

            if (body.failed.length > 0) {
              notifier.warning(`${body.failed.length} konnten nicht hochgeladen werden:` +
                  `<ul>${body.failed.map((a) => `<li>${a.file} (${a.reason || 'Unbekannter Fehler'})</li>`).join()}</ul>`);
            } else {
              notifier.success(`${body.succeeded} Dateien wurden erfolgreich hochgeladen`);
            }

            reloadFileTable();
          })
          .catch(err => {
            notifier.alert(`Beim Upload ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
            console.error('Error while uploading file(s):', err);
          })
          .finally(() => {
            uploadForm.disabled = false;
            buttons.forEach((btn) => btn.disabled = false);
          });
    });

    tmpInput.click();
  });

  /* Setup file table and the file details sidebar */
  let lastClickElement;
  let lastClick = -1;

  const filePreviewElement = document.getElementById('filePreviewModal');
  const filePreviewModal = new bootstrap.Modal(filePreviewElement, {
    keyboard: true,
    focus: true
  });
  const filePreviewIFrame = document.querySelector('#filePreviewModal iframe');
  filePreviewElement.addEventListener('hidden.bs.modal', () => {
    filePreviewIFrame.src = '';
  });

  document.querySelectorAll('#fileTable tbody tr')
      .forEach((elem) => {
        // 'Disable' all a-tags
        elem.querySelectorAll('a').forEach((a) => a.style.pointerEvents = 'none');

        // TODO: Use event 'dblclick' instead
        elem.addEventListener('click', () => {
          const fileMeta = extractFileMetaFromEntry(elem);

          if (userAgentHasTouchScreen() || (lastClickElement === elem && lastClick !== -1 && Date.now() - lastClick <= 550)) {
            if (fileMeta.isFile) {
              filePreviewIFrame.src = fileMeta.previewUrl;
              filePreviewModal.show();
            } else {
              location.href = fileMeta.href;
            }
          } else if (lastClickElement !== elem) {
            if (lastClickElement) {
              lastClickElement.classList.remove('table-active');
            }

            elem.classList.add('table-active');
            updateFileDetails(fileMeta, () => lastClickElement === elem);
          }

          lastClickElement = elem;
          lastClick = Date.now();
        });
      });

  document.addEventListener('keydown', (e) => {
    if (lastClickElement) {
      const isUp = e.code === 'ArrowUp';

      if (isUp || e.code === 'ArrowDown') {
        let targetIndex = -1;

        const trElements = document.querySelectorAll('#fileTable tbody tr');

        for (let i = 0; i < trElements.length; ++i) {
          if (lastClickElement === trElements.item(i)) {
            targetIndex = i;
            break;
          }
        }

        targetIndex += isUp ? -1 : 1;
        let upcomingTrIndex = isUp ? -1 : targetIndex + 1;

        if (targetIndex < 0) {
          targetIndex = trElements.length - 1;
        } else if (targetIndex > trElements.length - 1) {
          targetIndex = 0;
        }
        if (upcomingTrIndex > trElements.length - 1) {
          upcomingTrIndex = -1;
        }

        const targetTr = trElements.item(targetIndex);

        targetTr.click();

        if (targetTr.scrollIntoView &&
            (!isElementVisible(targetTr) ||
                (upcomingTrIndex !== -1 && !isElementVisible(trElements.item(upcomingTrIndex))))) {
          targetTr.scrollIntoView({behavior: 'smooth', block: isUp ? 'start' : 'end'});
        }

        e.preventDefault();
        return false;
      }
    }
  });

  /* Setup contextmenu */
  const ctxMenuDiv = document.getElementById('ctxMenu');

  window.addEventListener('click', e => {
    if (e.target.parentElement &&
        e.target.parentElement.tagName === 'LI' &&
        ctxMenuDiv.contains(e.target.parentElement)) {
      const action = e.target.parentElement.getAttribute('data-ctx-action');

      if (action) {
        const fileMeta = extractFileMetaFromEntry(lastClickElement);

        switch (action) {
          case 'download-file':
            location.href = fileMeta.downloadUrl;
            break;
          case 'delete-file':
            notifier.confirm(`Bist du sicher, dass du <strong>${fileMeta.name}</strong>${browsePageCfg.typeFront === 'trash' ? ' <em>PERMANENT</em>' : ''} löschen möchtest?`,
                () => {
                  notifier.asyncBlock(new Promise((resolve, reject) => {
                    fetch(fileMeta.href, {
                      method: 'DELETE',
                      headers: {
                        Accept: 'application/json'
                      }
                    })
                        .then(httpRes => {
                          if (httpRes.ok) {
                            reloadFileTable();
                            return resolve(`<strong>${fileMeta.name}</strong> wurde erfolgreich gelöscht`);
                          } else {
                            return reject(`<strong>${fileMeta.name}</strong> konnten nicht gelöscht werden!`);
                          }
                        })
                        .catch(err => {
                          console.error('Error while deleting file(s):', err);

                          return reject(`Beim Löschen ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
                        });
                  }));
                });
            break;
          case 'rename-file':
            notifier.confirm(`Bist du sicher, dass du <strong>${fileMeta.name}</strong>${browsePageCfg.typeFront === 'trash' ? ' <em>PERMANENT</em>' : ''} löschen möchtest?`,
                () => {
                  notifier.asyncBlock(new Promise((resolve, reject) => {
                    fetch(fileMeta.href, {
                      method: 'POST',
                      headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({action: 'rename', name: 'New-Name'})
                    })
                        .then(httpRes => {
                          if (httpRes.ok) {
                            reloadFileTable();
                            return resolve(`<strong>${fileMeta.name}</strong> wurde erfolgreich umbenannt`);
                          } else {
                            return reject(`<strong>${fileMeta.name}</strong> konnten nicht umbenannt werden!`);
                          }
                        })
                        .catch(err => {
                          console.error('Error while renaming file(s):', err);

                          return reject(`Beim Umbenennen ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
                        });
                  }));
                });
            break;
          case 'ffmpeg':
            notifier.asyncBlock(new Promise((resolve, reject) => {
              fetch(fileMeta.href, {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({action: 'ffprobe'})
              })
                  .then(httpRes => {
                    if (httpRes.ok) {
                      httpRes.json()
                          .then((resBody) => {
                            prepareModal('ffmpeg', {streams: resBody.streams, fileURI: fileMeta.href});

                            modal.show();
                            return resolve(`<strong>${fileMeta.name}</strong> wurde analysiert`);
                          });

                      // reloadFileTable();
                      // return resolve(`<strong>${fileMeta.name}</strong> wurde erfolgreich umbenannt`);
                    } else {
                      return reject(`<strong>${fileMeta.name}</strong> konnte nicht analysiert werden!`);
                    }
                  })
                  .catch(err => {
                    console.error('Error while renaming file(s):', err);

                    return reject(`Beim Umbenennen ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
                  });
            }));
            break;
          default:
            console.error('Unknown context menu action:', action);
            break;
        }
      } else {
        e.preventDefault();
      }
    }

    if (!e.defaultPrevented) {
      ctxMenuDiv.style.display = null;
    }
  });

  window.addEventListener('contextmenu', e => {
    if (e.target.parentElement &&
        e.target.parentElement.tagName === 'TR' &&
        e.target.parentElement.hasAttribute('data-nas-filename') &&
        document.getElementById('fileTable').contains(e.target)) {
      e.preventDefault();

      if (lastClickElement !== e.target.parentElement) {
        e.target.parentElement.click();
      }

      const fileMeta = extractFileMetaFromEntry(e.target.parentElement);

      ctxMenuDiv.querySelector('.dropdown-header').innerText = fileMeta.name;

      ctxMenuDiv.style.left = `${e.pageX}px`;
      ctxMenuDiv.style.top = `${e.pageY}px`;

      ctxMenuDiv.style.display = 'block';

      return false;
    } else if (!ctxMenuDiv.contains(e.target)) {
      ctxMenuDiv.style.display = null;
    }
  });

  /* misc */
  modalElem = document.getElementById('modal');
  modal = new bootstrap.Modal(modalElem, {
    keyboard: true,
    focus: true
  });
}

function updateFileDetails(fileMeta, stillValid) {
  // Reset details
  document.getElementById('fileDetailsName').innerText = fileMeta ? fileMeta.name : '';
  document.getElementById('fileDetailsInfoTab').innerHTML =
      fileMeta ?
          'Typ:      <em>Loading...</em><br>' +
          'Größe:    <em>Loading...</em><br>' +
          'Geändert: <em>Loading...</em><br>' +
          'Erstellt: <em>Loading...</em>' :
          '<em>Wähle eine Datei aus der Liste</em>';

  if (fileMeta) {
    fetch(fileMeta.href, {headers: {Accept: 'application/json'}})
        .then((res) => {
          if (!res.ok) {
            console.error(`Requesting file details for ${fileMeta.name} did return ${res.status}`);

            if (res.status === 404) {
              reloadFileTable();
            } else {
              updateFileDetails(null);
            }
          } else {
            return res.json()
                .then((body) => {
                  if (stillValid()) {
                    if (!body.isDirectory) {
                      const getMimeName = () => body.mime.charAt(0).toUpperCase() + body.mime.substring(1, body.mime.indexOf('/'));

                      document.getElementById('fileDetailsName').innerHTML =
                          `<img class="img-fluid" style="max-height: 40vh" src="/thumbnail${window.location.pathname}/${fileMeta.name}?size=500"><br>` +
                          document.getElementById('fileDetailsName').innerHTML;

                      document.getElementById('fileDetailsInfoTab').innerHTML =
                          `Typ: ${body.mime ? `${getMimeName()} (${body.mime})` : (body.sizeInByte > 0 ? 'Unbekannt' : 'Leer')}<br>
                           Größe: ${toHumanFileSize(body.sizeInByte)} (${body.sizeInByte.toLocaleString('de-DE')} Byte)<br>
                           Geändert: ${new Date(body.lastModified).toUTCString()}<br>
                           Erstellt: ${new Date(body.creationTime).toUTCString()}`;

                      let metaHtml = '';
                      if (body.meta) {
                        for (const metaKey in body.meta) {
                          if (body.meta.hasOwnProperty(metaKey)) {
                            const metaValue = body.meta[metaKey];

                            metaHtml += `${sanitizeHtmlTags(metaKey)}: ${sanitizeHtmlTags(metaValue.toString())}<br>`;
                          }
                        }
                      }
                      document.getElementById('fileDetailsMetaTab').innerHTML = metaHtml || '<strong><em>No data available</em><strong>';
                    } else {
                      document.getElementById('fileDetailsInfoTab').innerHTML =
                          `Typ: Verzeichnis<br>
                           Größe: ${toHumanFileSize(body.sizeInByte)} (${body.sizeInByte.toLocaleString('de-DE')} Byte)<br>
                           Enthaltene Dateien: ${body.fileCount}<br>
                           Enthaltene Verzeichnisse: ${body.directoryCount}`;

                      document.getElementById('fileDetailsMetaTab').innerHTML = '<strong><em>No data available</em><strong>';
                    }
                  }
                });
          }
        })
        .catch((err) => {
          console.error(`Encountered an error while updating file details`, err);
          updateFileDetails(null);
        });
  }
}

function reloadFileTable() {
  console.info('Refreshing current file table');
  location.reload();
}

function extractFileMetaFromEntry(elem) {
  return {
    href: elem.getAttribute('data-href'),
    downloadUrl: elem.getAttribute('data-nas-download'),
    previewUrl: elem.getAttribute('data-nas-preview'),

    name: elem.getAttribute('data-nas-filename'),
    isFile: elem.getAttribute('data-nas-isFile') === '1'
  };
}

/**
 * @param {Event} e
 */
function mkdirDialog(e) {
  if (e) {
    if (e.target.nodeName === 'FORM') {
      e.preventDefault();

      const dirName = e.target.querySelector('input[type="text"]').value;

      fetch(location.pathname, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({action: 'mkdir', relPath: dirName})
      })
          .then(httpRes => {
            if (httpRes.status === 200) {
              return httpRes.json();
            } else {
              throw new Error(`Server returned status ${httpRes.status}`);
            }
          })
          .then(body => {
            console.log('mkdir result:', body);

            if (body.message) {
              notifier.warning(body.message);
            }

            reloadFileTable();
          })
          .catch(err => {
            notifier.alert(`Beim Erstellen des Verzeichnisses ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
            console.error('Error while creating a directory:', err);
          })
          .finally(() => {
            modal.hide();
            // TODO: disable and un-disable the 'New' button
          });
    } else if (e.target.nodeName === 'INPUT') {
      const input = e.target.value; // TODO: Parse input and show the directories being created (+ support '..' and '/')

      let invalidDesc = null;
      let infoTxt = null;

      if (input.indexOf('\0') !== -1) {
        invalidDesc = 'Enthält ungültige Zeichen';
      } else if (input === '.' || input === '..') {
        invalidDesc = 'Ungültige Bezeichnung für ein Verzeichnis';
      } else if (input.indexOf('/') === 0) {
        invalidDesc = 'Absolute Pfade werden aktuell nicht unterstützt';  // TODO: support absolute paths
      } else if (new Blob([input]).size > 255) {
        invalidDesc = 'You are exceeding 255 bytes';  // TODO: Support support sub directories
      }

      if (input.indexOf('/') > 0) {
        infoTxt = 'Für den angegebene Verzeichnispfad werden fehlende Unterverzeichnisse automatisch erstellen';
      }

      if (invalidDesc) {
        e.target.parentElement.querySelector('div.invalid-feedback')
            .innerText = invalidDesc;

        e.target.classList.add('is-invalid');
      } else {
        e.target.classList.remove('is-invalid');
      }

      const alertElem = modalElem.querySelector('div[role="alert"]');
      if (infoTxt) {
        alertElem.innerText = infoTxt;
        alertElem.classList.remove('d-none');
      } else {
        alertElem.classList.add('d-none');
        alertElem.innerText = '';
      }
    } else {
      console.error('Unsupported event target:', e.target);
    }
  } else {
    prepareModal('mkdir');
    modal.show();
  }
}

/**
 * @param {DragEvent} e
 * @param {boolean} isExit
 */
function onFilesDrag(e, isExit) {
  if (e.target.closest) {
    const dropZoneElem = e.target.closest('.drop-zone');

    if (dropZoneElem) {
      e.preventDefault();

      if (isExit) {
        dropZoneElem.style.backgroundColor = null;
      } else {
        dropZoneElem.style.backgroundColor = 'red';
      }
    }
  }
}

/**
 * @param {DragEvent} e
 */
function onFilesDrop(e) {
  e.target.closest('.drop-zone').style.backgroundColor = null;

  console.log('File(s) dropped');

  // Prevent default behavior (Prevent file from being opened)
  e.preventDefault();

  const formData = new FormData();
  let formDataEmpty = true;

  // TODO: support directories
  if (e.dataTransfer.items) {
    for (let i = 0; i < e.dataTransfer.items.length; ++i) {
      // If dropped items aren't files, reject them
      if (e.dataTransfer.items[i].kind === 'file') {
        const file = e.dataTransfer.items[i].getAsFile();

        if (!file.type && file.size === 0) {
          console.error(`Failed adding '${file.name}' (${file.type || 'UNKNOWN TYPE'}) for upload (${file.size} byte) as it does not look like a file`);
          notifier.warning(`Failed adding '${file.name}' (${file.type || 'UNKNOWN TYPE'}) for upload (${file.size} byte) as it does not look like a file`);
        } else {
          formData.append('fUpload', file);
          formDataEmpty = false;

          console.debug(`Adding '${file.name}' (${file.type || 'UNKNOWN TYPE'}) for upload (${file.size} byte)`);
        }
      }
    }
  } else {
    for (let i = 0; i < e.dataTransfer.files.length; ++i) {
      const file = e.dataTransfer.files[i];

      formData.append('fUpload', file);
      formDataEmpty = false;

      console.debug(`Adding '${file.name}' (${file.type || 'UNKNOWN TYPE'}) for upload (${file.size} byte)`);
    }
  }

  if (!formDataEmpty) {
    fetch(location.pathname, {
      method: 'POST',
      headers: {
        Accept: 'application/json'
      },
      body: formData
    })
        .then(httpRes => {
          if (httpRes.status === 200) {
            return httpRes.json();
          } else {
            throw new Error(`Server returned status ${httpRes.status}`);
          }
        })
        .then(body => {
          console.log('Upload result:', body);

          if (body.failed.length > 0) {
            notifier.warning(`${body.failed.length} konnten nicht hochgeladen werden:` +
                `<ul>${body.failed.map((a) => `<li>${a.file} (${a.reason || 'Unbekannter Fehler'})</li>`).join()}</ul>`);
          } else {
            notifier.success(`${body.succeeded} Dateien wurden erfolgreich hochgeladen`);
          }

          if (body.succeeded > 0) {
            reloadFileTable();
          }
        })
        .catch(err => {
          notifier.alert(`Beim Upload ist ein kritischer Fehler aufgetreten: <code>${err.message}</code>`);
          console.error('Error while uploading file(s):', err);
        })
        .finally(() => {
          // uploadForm.disabled = false;
          // buttons.forEach((btn) => btn.disabled = false);
        });
  }
}

/**
 * Format bytes as human-readable text
 *
 * @author mpen (https://stackoverflow.com/a/14919494/9346616)
 *
 * @param {number} bytes  Number of bytes
 * @param {boolean} si True to use metric (SI) units, aka powers of 1000. False to use binary (IEC), aka powers of 1024
 * @param {number} dp Number of decimal places to display
 *
 * @return {string} The formatted string
 */
function toHumanFileSize(bytes, si = false, dp = 2) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
      ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
      : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * @author Andy E (https://stackoverflow.com/a/15203639/9346616)
 *
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  const vWidth = window.innerWidth || document.documentElement.clientWidth;
  const vHeight = window.innerHeight || document.documentElement.clientHeight;
  const efp = (x, y) => document.elementFromPoint(x, y);

  // Return false if it's not in the viewport
  if (rect.right < 0 || rect.bottom < 0
      || rect.left > vWidth || rect.top > vHeight) {
    return false;
  }

  // Return true if all of its four corners are visible
  return el.contains(efp(rect.left, rect.top)) ||
      el.contains(efp(rect.right, rect.top)) ||
      el.contains(efp(rect.right, rect.bottom)) ||
      el.contains(efp(rect.left, rect.bottom));
}

/**
 * @param {string} str
 */
function sanitizeHtmlTags(str) {
  if (typeof str !== 'string') throw new Error(`str is not a string but a '${typeof str}'`);

  return str.replace(/</g, '&gt;')
      .replace(/>/g, '&lt;');
}
