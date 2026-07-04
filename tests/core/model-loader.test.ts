import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchModelBlob } from '../../src/core/detectors/model-loader.ts';

/**
 * Build a Response-like object with a streaming body that yields the given
 * chunks and then either completes or errors.
 */
function streamResponse(
  chunks: Uint8Array[],
  opts: { status?: number; total?: number; rangeStart?: number; failAfter?: boolean } = {},
): Response {
  const { status = 200, total, rangeStart, failAfter = false } = opts;
  const headers = new Headers();
  if (total !== undefined) {
    if (status === 206 && rangeStart !== undefined) {
      headers.set('content-range', `bytes ${rangeStart}-${total - 1}/${total}`);
    } else {
      headers.set('content-length', String(total));
    }
  }

  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else if (failAfter) {
        controller.error(new TypeError('network error'));
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body,
  } as unknown as Response;
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  // jsdom's Blob does not implement arrayBuffer(); go through FileReader
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const bytes = (...values: number[]) => new Uint8Array(values);

/** Keep retry backoff near-instant so tests do not wait out real delays */
const FAST_RETRY = { retryBaseDelayMs: 1 };

describe('fetchModelBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // No Cache API / storage manager in jsdom - the loader must handle both
    vi.stubGlobal('caches', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads a model in one attempt and reports final progress', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse([bytes(1, 2), bytes(3, 4)], { total: 4 }));

    const progress: Array<[number, number]> = [];
    const blob = await fetchModelBlob('https://example.com/model.onnx', (d, t) => progress.push([d, t]));

    expect(await blobBytes(blob)).toEqual(bytes(1, 2, 3, 4));
    expect(progress[progress.length - 1]).toEqual([4, 4]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resumes with a Range request after a mid-download network failure', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // First attempt: 2 of 4 bytes, then the connection dies
    fetchMock.mockResolvedValueOnce(
      streamResponse([bytes(1, 2)], { total: 4, failAfter: true }),
    );
    // Second attempt: server honors Range and sends the remaining 2 bytes
    fetchMock.mockResolvedValueOnce(
      streamResponse([bytes(3, 4)], { status: 206, total: 4, rangeStart: 2 }),
    );

    const blob = await fetchModelBlob('https://example.com/model.onnx', undefined, FAST_RETRY);

    expect(await blobBytes(blob)).toEqual(bytes(1, 2, 3, 4));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((secondCallInit.headers as Record<string, string>)['Range']).toBe('bytes=2-');
  });

  it('restarts cleanly when the server ignores the Range header', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streamResponse([bytes(1, 2)], { total: 4, failAfter: true }),
    );
    // Server replies 200 with the full body despite the Range request
    fetchMock.mockResolvedValueOnce(
      streamResponse([bytes(1, 2), bytes(3, 4)], { status: 200, total: 4 }),
    );

    const blob = await fetchModelBlob('https://example.com/model.onnx', undefined, FAST_RETRY);

    expect(await blobBytes(blob)).toEqual(bytes(1, 2, 3, 4));
  });

  it('retries when the body ends before content-length is reached', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // Stream closes cleanly after 2 of 4 bytes (truncated by a proxy)
    fetchMock.mockResolvedValueOnce(streamResponse([bytes(1, 2)], { total: 4 }));
    fetchMock.mockResolvedValueOnce(
      streamResponse([bytes(3, 4)], { status: 206, total: 4, rangeStart: 2 }),
    );

    const blob = await fetchModelBlob('https://example.com/model.onnx', undefined, FAST_RETRY);

    expect(await blobBytes(blob)).toEqual(bytes(1, 2, 3, 4));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails immediately on non-retryable HTTP errors', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(streamResponse([], { status: 404 }));

    await expect(fetchModelBlob('https://example.com/missing.onnx')).rejects.toThrow('404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await expect(fetchModelBlob('https://example.com/model.onnx', undefined, FAST_RETRY)).rejects.toThrow('network down');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
