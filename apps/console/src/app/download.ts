/** A file the server sent as JSON: text, or bytes in base64 (report exports, table tents). */
export interface ServerFile {
  readonly filename: string;
  readonly contentType: string;
  readonly encoding: 'utf-8' | 'base64';
  readonly content: string;
}

function fileBytes(file: ServerFile): BlobPart {
  if (file.encoding === 'utf-8') return file.content;
  const binary = atob(file.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Hands the file to the browser's download, under the server's file name. */
export function downloadFile(file: ServerFile): void {
  const url = URL.createObjectURL(new Blob([fileBytes(file)], { type: file.contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Hands bytes the server sent as themselves (a menu file) to the browser's download. */
export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
