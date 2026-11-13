// Small AbortSignal helpers shared by the fetch code.

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Settle with `promise`, or reject with an AbortError as soon as `signal`
 * aborts.  Does not cancel the underlying work (use when it is shared).
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
