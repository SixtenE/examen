import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "../app/page";
import Providers from "../components/providers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <Providers>
      <Page />
    </Providers>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("submitting the form uploads the selected file", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/upload") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "abc", key: "uploads/abc" }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  const file = new File(["hello"], "hello.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload an image") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  fireEvent.submit(screen.getByLabelText("Upload an image").closest("form")!);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/queries/abc/matches",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

test("redirects to the query page after successful upload", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/upload") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "abc", key: "uploads/abc" }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  const file = new File(["hello"], "hello.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload an image") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  fireEvent.submit(screen.getByLabelText("Upload an image").closest("form")!);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/queries/abc/matches",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

test("shows an error message if the upload fails", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Upload failed" }),
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  const file = new File(["hello"], "hello.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload an image") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  fireEvent.submit(screen.getByLabelText("Upload an image").closest("form")!);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

test("shows error when uploading a file that is not an image", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "File is not an image" }),
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const input = screen.getByLabelText("Upload an image") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  fireEvent.submit(screen.getByLabelText("Upload an image").closest("form")!);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
