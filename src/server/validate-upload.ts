import { UploadError, uploadErrorCode } from "../shared/upload-policy";

export function validateUpload(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./validation-worker.ts", import.meta.url).href);
    const finish = (): void => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new UploadError("timeout"));
    }, 10_000);
    worker.onmessage = ({ data }) => {
      finish();
      if (data.bytes instanceof Uint8Array) resolve(data.bytes);
      else reject(new UploadError(uploadErrorCode(data.error)));
    };
    worker.onerror = () => {
      finish();
      reject(new UploadError("internal"));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new UploadError("internal"));
    };
    try {
      worker.postMessage(bytes, [bytes.buffer]);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
