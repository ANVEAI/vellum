"use client";

/**
 * Chart data editor — the chart node's rows as a spreadsheet-style table.
 * First column is the category; other columns are series. Add/remove rows
 * and columns; values persist as strings so units ($ % k) survive.
 */
import { useMemo, useState } from "react";
import { Button, Dialog, IconButton } from "./primitives";

type Row = Record<string, string | number>;

export function ChartDataEditor({
  chartType,
  rows,
  onApply,
  onClose,
}: {
  chartType: string;
  rows: Row[];
  onApply: (rows: Row[]) => void;
  onClose: () => void;
}) {
  const initialFields = useMemo(
    () => (rows.length ? Object.keys(rows[0]) : ["label", "value"]),
    [rows],
  );
  const [fields, setFields] = useState<string[]>(initialFields);
  const [grid, setGrid] = useState<string[][]>(() =>
    (rows.length ? rows : [{} as Row]).map((row) =>
      initialFields.map((f) => String(row[f] ?? "")),
    ),
  );

  const setCell = (r: number, c: number, value: string) =>
    setGrid((g) =>
      g.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)),
    );

  const renameField = (c: number, name: string) =>
    setFields((f) => f.map((field, ci) => (ci === c ? name : field)));

  const addRow = () => setGrid((g) => [...g, fields.map(() => "")]);
  const removeRow = (r: number) => setGrid((g) => g.filter((_, ri) => ri !== r));
  const addColumn = () => {
    setFields((f) => [...f, `series ${f.length}`]);
    setGrid((g) => g.map((row) => [...row, ""]));
  };
  const removeColumn = (c: number) => {
    if (fields.length <= 2) return;
    setFields((f) => f.filter((_, ci) => ci !== c));
    setGrid((g) => g.map((row) => row.filter((_, ci) => ci !== c)));
  };

  const apply = () => {
    const next: Row[] = grid
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .map((row) => Object.fromEntries(fields.map((f, ci) => [f, row[ci] ?? ""])));
    onApply(next);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={720}
      title="Edit chart data"
      description={`${chartType.replace("chart-", "")} · first column is the category axis`}
      footer={
        <>
          <Button icon="plus" onClick={addRow} className="mr-auto">
            Row
          </Button>
          <Button icon="plus" onClick={addColumn} className="mr-auto">
            Series
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div
        className="scroll-thin max-h-[52vh] overflow-auto rounded-[6px]"
        style={{ boxShadow: "inset 0 0 0 1px var(--hairline)" }}
      >
        <table className="w-full" style={{ fontSize: "var(--t-body)" }}>
          <thead className="sticky top-0 bg-[var(--bg-well)]">
            <tr>
              {fields.map((field, c) => (
                <th key={c} className="hairline-b p-1 text-left">
                  <div className="flex items-center gap-1">
                    <input
                      value={field}
                      aria-label={`Column ${c + 1} name`}
                      onChange={(e) => renameField(c, e.target.value)}
                      className="input-bare font-semibold"
                    />
                    {c > 0 && fields.length > 2 && (
                      <IconButton
                        icon="close"
                        size="sm"
                        label={`Remove column ${field}`}
                        onClick={() => removeColumn(c)}
                      />
                    )}
                  </div>
                </th>
              ))}
              <th className="hairline-b w-9" />
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="hairline-b p-0">
                    <input
                      value={cell}
                      aria-label={`${fields[c]}, row ${r + 1}`}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className="input-bare"
                    />
                  </td>
                ))}
                <td className="hairline-b text-center">
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Remove row ${r + 1}`}
                    onClick={() => removeRow(r)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
