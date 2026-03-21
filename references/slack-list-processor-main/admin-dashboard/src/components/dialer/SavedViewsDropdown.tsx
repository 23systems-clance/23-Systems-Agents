/**
 * SavedViewsDropdown Component (T094)
 *
 * Dropdown for loading, saving, and deleting persisted analytics views.
 * Provides a compact UI with inline name input for creating new views.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Bookmark, ChevronDown, Trash2, Plus } from 'lucide-react';
import type { SavedView } from '@/services/analytics-api';

interface SavedViewsDropdownProps {
  /** List of previously saved views. */
  views: SavedView[];
  /** Called when the user selects a view to load. */
  onLoadView: (view: SavedView) => void;
  /** Called when the user saves the current filter state with a name. */
  onSaveView: (name: string) => void;
  /** Called when the user deletes a saved view. */
  onDeleteView: (id: string) => void;
}

export function SavedViewsDropdown({
  views,
  onLoadView,
  onSaveView,
  onDeleteView,
}: SavedViewsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  /** Close on outside click. */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsSaving(false);
        setNewName('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Focus the name input when the save form opens. */
  useEffect(() => {
    if (isSaving && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isSaving]);

  /** Handle saving a new view. */
  const handleSave = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveView(trimmed);
    setNewName('');
    setIsSaving(false);
  };

  /** Handle keyboard events in the name input. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    }
    if (e.key === 'Escape') {
      setIsSaving(false);
      setNewName('');
    }
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors',
          isOpen
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        )}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Views
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-gray-200 bg-white shadow-lg">
          {/* Saved View List */}
          <div className="max-h-48 overflow-y-auto">
            {views.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-500">
                No saved views yet
              </p>
            ) : (
              views.map((view) => (
                <div
                  key={view.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 transition-colors group"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onLoadView(view);
                      setIsOpen(false);
                    }}
                    className="flex-1 text-left text-sm text-gray-700 truncate hover:text-blue-600 transition-colors"
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteView(view.id);
                    }}
                    className="shrink-0 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete view"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200" />

          {/* Save Current View */}
          {isSaving ? (
            <div className="p-2">
              <div className="flex items-center gap-1.5">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="View name..."
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!newName.trim()}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSaving(true)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Save Current View
            </button>
          )}
        </div>
      )}
    </div>
  );
}
