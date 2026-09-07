import { UploadError } from "../shared/upload-policy";
import { validateGif } from "./validate-gif";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Uint8Array<ArrayBuffer>>) => void;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
  try {
    validateGif(data);
    scope.postMessage({ bytes: data }, [data.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof UploadError ? error.code : "internal" });
  }
};
