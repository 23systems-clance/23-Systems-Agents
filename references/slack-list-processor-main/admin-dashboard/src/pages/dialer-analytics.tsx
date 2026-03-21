/**
 * Dialer Analytics Page (T095)
 *
 * Main analytics dashboard for the Power Dialer. Features 5 tabbed views
 * (Rep Performance, List Performance, Account Performance, Objections,
 * When to Call), persistent KPI cards, filter panel, and saved views.
 * Tab state is persisted in URL search params.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  History,
} from 'lucide-react';
import * as analyticsApi from '@/services/analytics-api';
import type {
  KPISummary,
  RepPerformanceRow,
  ListPerformanceRow,
  AccountPerformanceRow,
  ObjectionRow,
  WhenToCallCell,
  SavedView,
} from '@/services/analytics-api';
import { AnalyticsKPICards } from '@/components/dialer/AnalyticsKPICards';
import { RepPerformanceTable } from '@/components/dialer/RepPerformanceTable';
import { ListPerformanceTable } from '@/components/dialer/ListPerformanceTable';
import { AccountPerformanceTable } from '@/components/dialer/AccountPerformanceTable';
import { AnalyticsFilters } from '@/components/dialer/AnalyticsFilters';
import { SavedViewsDropdown } from '@/components/dialer/SavedViewsDropdown';
import { ObjectionsTable } from '@/components/dialer/ObjectionsTable';
import { WhenToCallHeatmap } from '@/components/dialer/WhenToCallHeatmap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'rep' | 'list' | 'account' | 'objections' | 'when-to-call';

interface TabDef {
  id: TabId;
  label: string;
}

interface FilterValues {
  startDate: string;
  endDate: string;
  bdrIds: string[];
  campaignIds: string[];
  companyNames: string[];
  callTypes: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: TabDef[] = [
  { id: 'rep', label: 'Rep Performance' },
  { id: 'list', label: 'List Performance' },
  { id: 'account', label: 'Account Performance' },
  { id: 'objections', label: 'Objections' },
  { id: 'when-to-call', label: 'When to Call' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO date string (YYYY-MM-DD) for the given Date. */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns default date range: last 30 days. */
function getDefaultDateRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const past = new Date(now);
  past.setDate(now.getDate() - 30);
  return { startDate: toISODate(past), endDate: toISODate(now) };
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function DialerAnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state from URL
  const activeTab = (searchParams.get('tab') as TabId) || 'rep';
  const setActiveTab = useCallback(
    (tab: TabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      });
    },
    [setSearchParams],
  );

  // Client ID from search params or fallback
  const clientId = searchParams.get('clientId') || 'default';

  // Default filter state
  const defaultRange = getDefaultDateRange();
  const [filters, setFilters] = useState<FilterValues>({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    bdrIds: [],
    campaignIds: [],
    companyNames: [],
    callTypes: [],
  });

  // Available filter options (populated from API or empty for now)
  const [availableBdrs] = useState<Array<{ id: string; name: string }>>([]);
  const [availableCampaigns] = useState<Array<{ id: string; name: string }>>([]);

  // Data states
  const [kpiData, setKpiData] = useState<KPISummary | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [repData, setRepData] = useState<RepPerformanceRow[]>([]);
  const [repLoading, setRepLoading] = useState(false);

  const [listData, setListData] = useState<ListPerformanceRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [accountData, setAccountData] = useState<AccountPerformanceRow[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);

  const [objectionData, setObjectionData] = useState<ObjectionRow[]>([]);
  const [objectionLoading, setObjectionLoading] = useState(false);

  const [whenToCallData, setWhenToCallData] = useState<WhenToCallCell[]>([]);
  const [whenToCallLoading, setWhenToCallLoading] = useState(false);

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  /** Build analytics filter params from current state. */
  const buildFilters = useCallback(
    (): analyticsApi.AnalyticsFilters => ({
      clientId,
      ...filters,
    }),
    [clientId, filters],
  );

  /** Fetch KPI summary. */
  const fetchKPI = useCallback(async () => {
    setKpiLoading(true);
    try {
      const data = await analyticsApi.getKPISummary(buildFilters());
      setKpiData(data);
    } catch {
      // KPI fetch failed silently; cards will show loading/null state
    } finally {
      setKpiLoading(false);
    }
  }, [buildFilters]);

  /** Fetch tab-specific data. */
  const fetchTabData = useCallback(async () => {
    const f = buildFilters();

    switch (activeTab) {
      case 'rep':
        setRepLoading(true);
        try {
          setRepData(await analyticsApi.getRepPerformance(f));
        } catch {
          setRepData([]);
        } finally {
          setRepLoading(false);
        }
        break;

      case 'list':
        setListLoading(true);
        try {
          setListData(await analyticsApi.getListPerformance(f));
        } catch {
          setListData([]);
        } finally {
          setListLoading(false);
        }
        break;

      case 'account':
        setAccountLoading(true);
        try {
          setAccountData(await analyticsApi.getAccountPerformance(f));
        } catch {
          setAccountData([]);
        } finally {
          setAccountLoading(false);
        }
        break;

      case 'objections':
        setObjectionLoading(true);
        try {
          setObjectionData(await analyticsApi.getObjections(f));
        } catch {
          setObjectionData([]);
        } finally {
          setObjectionLoading(false);
        }
        break;

      case 'when-to-call':
        setWhenToCallLoading(true);
        try {
          setWhenToCallData(await analyticsApi.getWhenToCall(f));
        } catch {
          setWhenToCallData([]);
        } finally {
          setWhenToCallLoading(false);
        }
        break;
    }
  }, [activeTab, buildFilters]);

  /** Fetch saved views on mount. */
  useEffect(() => {
    analyticsApi.listSavedViews().then(setSavedViews).catch(() => {});
  }, []);

  /** Fetch data on mount and when filters or active tab change. */
  useEffect(() => {
    fetchKPI();
    fetchTabData();
  }, [fetchKPI, fetchTabData]);

  /** Handle saving a new view. */
  const handleSaveView = async (name: string) => {
    try {
      const view = await analyticsApi.createSavedView(name, activeTab, filters as unknown as Record<string, unknown>);
      setSavedViews((prev) => [...prev, view]);
    } catch {
      // Save failed silently
    }
  };

  /** Handle loading a saved view. */
  const handleLoadView = (view: SavedView) => {
    const viewFilters = view.filters as unknown as FilterValues;
    if (viewFilters) {
      setFilters({
        startDate: viewFilters.startDate || filters.startDate,
        endDate: viewFilters.endDate || filters.endDate,
        bdrIds: viewFilters.bdrIds || [],
        campaignIds: viewFilters.campaignIds || [],
        companyNames: viewFilters.companyNames || [],
        callTypes: viewFilters.callTypes || [],
      });
    }
    if (view.tab) {
      setActiveTab(view.tab as TabId);
    }
  };

  /** Handle deleting a saved view. */
  const handleDeleteView = async (id: string) => {
    try {
      await analyticsApi.deleteSavedView(id);
      setSavedViews((prev) => prev.filter((v) => v.id !== id));
    } catch {
      // Delete failed silently
    }
  };

  /** Render tab content based on active tab. */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'rep':
        return <RepPerformanceTable data={repData} isLoading={repLoading} />;
      case 'list':
        return <ListPerformanceTable data={listData} isLoading={listLoading} />;
      case 'account':
        return <AccountPerformanceTable data={accountData} isLoading={accountLoading} />;
      case 'objections':
        return <ObjectionsTable data={objectionData} isLoading={objectionLoading} />;
      case 'when-to-call':
        return <WhenToCallHeatmap data={whenToCallData} isLoading={whenToCallLoading} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Dialer Analytics</h1>
        </div>
        <SavedViewsDropdown
          views={savedViews}
          onLoadView={handleLoadView}
          onSaveView={handleSaveView}
          onDeleteView={handleDeleteView}
        />
      </div>

      {/* KPI Cards (always visible) */}
      <AnalyticsKPICards data={kpiData} isLoading={kpiLoading} />

      {/* Filters */}
      <AnalyticsFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableBdrs={availableBdrs}
        availableCampaigns={availableCampaigns}
      />

      {/* Tab Bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'whitespace-nowrap border-b-2 pb-3 pt-1 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {renderTabContent()}

      {/* View Call History link placeholder */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
        >
          <History className="h-4 w-4" />
          View Call History
        </button>
      </div>
    </div>
  );
}
