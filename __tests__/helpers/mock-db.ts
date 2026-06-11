import { vi } from "vitest";

type ThenableChain = {
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function thenable<T>(value: T) {
  return {
    then(onFulfilled: (v: T) => unknown) {
      return Promise.resolve(value).then(onFulfilled);
    },
  };
}

export function createSelectChain(result: unknown[] = []): ThenableChain {
  const limit = vi.fn().mockReturnValue(Promise.resolve(result));
  const orderBy = vi.fn().mockReturnValue({
    limit,
    ...thenable(result),
  });
  const where = vi.fn().mockReturnValue({
    orderBy,
    limit,
    ...thenable(result),
  });
  return { where, orderBy, limit };
}

export function createDbMock(
  options: {
    selectResults?: unknown[][];
    updateReturning?: unknown[];
    insertReturning?: unknown[];
    transactionImpl?: (
      callback: (tx: unknown) => Promise<unknown>,
    ) => Promise<unknown>;
  } = {},
) {
  const selectResults = [...(options.selectResults ?? [])];
  const chains = selectResults.map((result) => createSelectChain(result));

  const select = vi.fn(() => ({
    from: vi.fn(() => chains.shift() ?? createSelectChain([])),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(options.updateReturning ?? []),
      })),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(options.insertReturning ?? []),
    })),
  }));

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteOp = vi.fn(() => ({ where: deleteWhere }));

  const tx = {
    delete: deleteOp,
    insert,
  };

  const transaction =
    options.transactionImpl ??
    vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );

  return {
    db: {
      select,
      update,
      insert,
      delete: deleteOp,
      transaction,
    },
    tx,
    deleteWhere,
  };
}
