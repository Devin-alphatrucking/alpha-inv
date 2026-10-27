import { Directory, File, Paths } from "expo-file-system";
import type { Files, LocalFile, Storage } from "./queue";

// The phone's side of the offline queue: the list is one small file, and each photo waiting to be sent is copied into
// the app's own folder (the camera's cache can be cleared by the phone at any time).

const folder = () => new Directory(Paths.document, "offline");
const photos = () => new Directory(Paths.document, "offline", "photos");

function ensure(dir: Directory) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export const queueStorage: Storage = {
  async read() {
    const file = new File(folder(), "queue.json");
    return file.exists ? await file.text() : null;
  },
  async write(text) {
    ensure(folder());
    const file = new File(folder(), "queue.json");
    if (!file.exists) file.create();
    file.write(text);
  },
};

export const photoFiles: Files = {
  async keep(file: LocalFile, ref: string, index: number) {
    ensure(photos());
    const extension = /\.(jpe?g|png|webp|heic)$/i.exec(file.name)?.[0] ?? ".jpg";
    const target = new File(photos(), `${ref}-${index}${extension.toLowerCase()}`);
    if (target.exists) target.delete();
    new File(file.uri).copy(target);
    return { uri: target.uri, name: file.name, type: file.type };
  },
  async drop(file: LocalFile) {
    const f = new File(file.uri);
    if (f.exists) f.delete();
  },
};
