import { useState, useCallback, useMemo } from 'react';
import { subDays, format } from 'date-fns';

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Manages a date range with sensible defaults (last 30 days). */
export function useDateRange(defaultDays = 30) {
  const [range, setRange] = useState<DateRange>(() => ({
    startDate: format(subDays(new Date(), defaultDays), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  }));

  const setDays = useCallback((days: number) => {
    setRange({
      startDate: format(subDays(new Date(), days), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    });
  }, []);

  const params = useMemo(
    () => ({ start_date: range.startDate, end_date: range.endDate }),
    [range],
  );

  return { range, setRange, setDays, params };
}
