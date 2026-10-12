import { vi } from "vitest";

type Records = Record<string, any>;

/**
 * A stand-in for the store client of a function or workflow. `records` maps a path to what a read
 * of it returns; the delivery issues collection is kept in memory so tests can see what was recorded.
 */
export function mockStore(settings: Records, records: Records = {}) {
  const issues: Records[] = [];
  let created = 0;

  const swell = {
    settings: vi.fn(async () => settings),
    get: vi.fn(async (path: string, query?: Records) => {
      if (path === "/delivery-issues") {
        return { results: issues.filter((issue) => issue.key === query?.where?.key) };
      }
      const record = records[path];
      return typeof record === "function" ? record(query) : (record ?? null);
    }),
    post: vi.fn(async (path: string, data: Records) => {
      if (path === "/delivery-issues") {
        const issue = { id: `issue-${++created}`, ...data };
        issues.push(issue);
        return issue;
      }
      throw new Error(`Unexpected write to ${path}`);
    }),
    put: vi.fn(async (path: string, data: Records) => {
      const issue = issues.find((item) => path === `/delivery-issues/${item.id}`);
      if (issue) {
        return Object.assign(issue, data);
      }
      return data;
    }),
    delete: vi.fn(async (path: string) => {
      const index = issues.findIndex((item) => path === `/delivery-issues/${item.id}`);
      if (index >= 0) {
        issues.splice(index, 1);
      }
      return {};
    }),
  };

  return { swell, issues };
}
