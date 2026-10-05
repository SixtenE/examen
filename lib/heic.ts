import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
// Keep the native decoder and its dependencies in Next.js deployment traces.
import "heic-convert";

const require = createRequire(import.meta.url);

export async function convertHeicToJpeg(buffer: Buffer, timeoutMs = 8_000) {
  // The decoder and JPEG encoder block their thread; a worker makes the deadline enforceable.
  const worker = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads");
     const convert = require(workerData.converter);
     convert({ buffer: Buffer.from(workerData.buffer), format: "JPEG", quality: 0.9 })
       .then(jpeg => parentPort.postMessage(jpeg));`,
    {
      eval: true,
      execArgv: [],
      workerData: {
        // Workers need a native file path, not the bundler's numeric module ID.
        converter: require.resolve(/* webpackIgnore: true */ "heic-convert"),
        buffer,
      },
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      worker.once("message", (jpeg: Uint8Array) => resolve(Buffer.from(jpeg)));
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(new Error(`HEIC decoder exited without an image (${code})`)),
      );
      timer = setTimeout(
        () => reject(new Error("HEIC decode timed out")),
        timeoutMs,
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
