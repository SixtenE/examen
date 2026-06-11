import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeleteDialog } from "../components/delete-dialog";
import Providers from "../components/providers";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderDialog() {
  return render(
    <Providers>
      <DeleteDialog id={QUERY_ID} />
    </Providers>,
  );
}

afterEach(() => {
  push.mockClear();
  vi.restoreAllMocks();
});

test("deletes the query and navigates home on confirm", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: "Query deleted" }),
  });
  vi.stubGlobal("fetch", fetchMock);

  renderDialog();

  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(`/api/queries/${QUERY_ID}`, {
      method: "DELETE",
    });
    expect(push).toHaveBeenCalledWith("/");
  });
});
