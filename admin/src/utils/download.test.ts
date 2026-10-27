// ============================================================
// CSV/下载工具单元测试
// 覆盖:csvEscape / toCsv / timestampedFilename
// (downloadBlob/downloadText/downloadJson 依赖 DOM,仅在 jsdom 冒烟验证不抛错)
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { csvEscape, toCsv, timestampedFilename, downloadText, downloadJson } from './download';

// jsdom 未实现 URL.createObjectURL/revokeObjectURL,测试前补桩
beforeAll(() => {
  if (!('createObjectURL' in URL)) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
  }
  if (!('revokeObjectURL' in URL)) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
});

describe('csvEscape', () => {
  it('returns empty for null/undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('returns empty for empty string', () => {
    expect(csvEscape('')).toBe('');
  });

  it('returns plain string as-is when no special chars', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(123)).toBe('123');
    expect(csvEscape(true)).toBe('true');
  });

  it('wraps in quotes when contains comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('wraps in quotes when contains newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"');
  });

  it('wraps and escapes double quotes by doubling them', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('escapes combined special chars', () => {
    expect(csvEscape('a,"b",c\nd')).toBe('"a,""b"",c\nd"');
  });
});

describe('toCsv', () => {
  it('produces header + data rows with CRLF and BOM', () => {
    const rows = [{ name: 'Alice', age: 30 }];
    const csv = toCsv(rows, ['name', 'age']);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const body = csv.slice(1); // strip BOM
    const lines = body.split('\r\n');
    expect(lines[0]).toBe('name,age');
    expect(lines[1]).toBe('Alice,30');
  });

  it('supports custom headers', () => {
    const rows = [{ id: 1, name: 'Bob' }];
    const csv = toCsv(rows, ['id', 'name'], ['ID', 'Name']);
    const body = csv.slice(1);
    expect(body.split('\r\n')[0]).toBe('ID,Name');
  });

  it('handles missing fields as empty', () => {
    const rows = [{ id: 1, name: 'Bob' }, { id: 2 }];
    const csv = toCsv(rows, ['id', 'name']);
    const lines = csv.slice(1).split('\r\n');
    // lines[0]=header, lines[1]=first row, lines[2]=second row with missing name
    expect(lines[2]).toBe('2,');
  });

  it('escapes fields containing commas', () => {
    const rows = [{ name: 'Alice, Jr' }];
    const csv = toCsv(rows, ['name']);
    expect(csv.slice(1).split('\r\n')[1]).toBe('"Alice, Jr"');
  });

  it('produces only header for empty rows', () => {
    const csv = toCsv([], ['a', 'b']);
    expect(csv).toBe('\uFEFFa,b');
  });
});

describe('timestampedFilename', () => {
  it('produces prefix_YYYYMMDD_HHMM.ext', () => {
    const name = timestampedFilename('users', 'csv');
    expect(name).toMatch(/^users_\d{8}_\d{4}\.csv$/);
  });

  it('supports different extensions', () => {
    const name = timestampedFilename('audit', 'json');
    expect(name).toMatch(/^audit_\d{8}_\d{4}\.json$/);
  });
});

describe('downloadText / downloadJson (jsdom smoke)', () => {
  it('downloadText does not throw', () => {
    expect(() => downloadText('hello', 'test.csv')).not.toThrow();
  });

  it('downloadJson does not throw', () => {
    expect(() => downloadJson({ a: 1 }, 'test.json')).not.toThrow();
  });
});
