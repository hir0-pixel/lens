import { useCallback, useEffect, useMemo, useRef, type ComponentType } from "react";
import { Search, Star, X } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  SETTINGS_NAV,
  searchSettings,
} from "@/shared/settings/registry";
import type { SettingsSectionId } from "@/shared/settings/defaults";
import { GeneralSettingsPage } from "./sections/GeneralSettingsPage";
import { AppearanceSettingsPage } from "./sections/AppearanceSettingsPage";
import { EditorSettingsPage } from "./sections/EditorSettingsPage";
import { TerminalSettingsPage } from "./sections/TerminalSettingsPage";
import { BrowserSettingsPage } from "./sections/BrowserSettingsPage";
import { AiSettingsPage } from "./sections/AiSettingsPage";
import { ModelsSettingsPage, ProvidersSettingsPage } from "./sections/ProvidersSettingsPage";
import {
  AboutSettingsPage,
  AccessibilitySettingsPage,
  GitSettingsPage,
  KeyboardSettingsPage,
  PrivacySettingsPage,
} from "./sections/MoreSettingsPages";

const SECTION_COMPONENT: Record<SettingsSectionId, ComponentType> = {
  general: GeneralSettingsPage,
  appearance: AppearanceSettingsPage,
  editor: EditorSettingsPage,
  terminal: TerminalSettingsPage,
  browser: BrowserSettingsPage,
  ai: AiSettingsPage,
  providers: ProvidersSettingsPage,
  models: ModelsSettingsPage,
  git: GitSettingsPage,
  privacy: PrivacySettingsPage,
  accessibility: AccessibilitySettingsPage,
  keyboard: KeyboardSettingsPage,
  about: AboutSettingsPage,
};

const SECTION_IDS = new Set(SETTINGS_NAV.map((n) => n.id));

function parseSettingsHash(): SettingsSectionId | null {
  const hash = window.location.hash.replace(/^#/, "");
  const match = hash.match(/^settings\/([\w-]+)/);
  if (!match) return null;
  const id = match[1] as SettingsSectionId;
  return SECTION_IDS.has(id) ? id : null;
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const q = query.trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-accent/25 px-0.5 text-accent">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function SettingsLayout() {
  const activeSection = useSettingsStore((s) => s.activeSection);
  const setSection = useSettingsStore((s) => s.setSection);
  const searchQuery = useSettingsStore((s) => s.searchQuery);
  const setSearchQuery = useSettingsStore((s) => s.setSearchQuery);
  const favorites = useSettingsStore((s) => s.favorites);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavorite);
  const recentSections = useSettingsStore((s) => s.recentSections);
  const pushSearchHistory = useSettingsStore((s) => s.pushSearchHistory);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollPositions = useRef<Partial<Record<SettingsSectionId, number>>>(
    {},
  );
  const navRefs = useRef<Partial<Record<SettingsSectionId, HTMLButtonElement>>>(
    {},
  );

  const searchHits = useMemo(
    () => searchSettings(searchQuery),
    [searchQuery],
  );

  const navItem = SETTINGS_NAV.find((n) => n.id === activeSection);
  const Page = SECTION_COMPONENT[activeSection];

  const goToSection = useCallback(
    (id: SettingsSectionId, clearSearch = true) => {
      if (contentRef.current) {
        scrollPositions.current[activeSection] = contentRef.current.scrollTop;
      }
      setSection(id);
      if (clearSearch) setSearchQuery("");
      window.history.replaceState(null, "", `#settings/${id}`);
    },
    [activeSection, setSection, setSearchQuery],
  );

  // Deep-link on mount + hash changes
  useEffect(() => {
    const fromHash = parseSettingsHash();
    if (fromHash && fromHash !== activeSection) {
      setSection(fromHash);
    } else if (!fromHash) {
      window.history.replaceState(null, "", `#settings/${activeSection}`);
    }
    function onHash() {
      const id = parseSettingsHash();
      if (id) setSection(id);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + hash only
  }, []);

  // Scroll restoration when section changes
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const saved = scrollPositions.current[activeSection] ?? 0;
    requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
  }, [activeSection]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const idx = SETTINGS_NAV.findIndex((n) => n.id === activeSection);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = SETTINGS_NAV[(idx + 1) % SETTINGS_NAV.length];
        goToSection(next.id);
        navRefs.current[next.id]?.focus();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev =
          SETTINGS_NAV[(idx - 1 + SETTINGS_NAV.length) % SETTINGS_NAV.length];
        goToSection(prev.id);
        navRefs.current[prev.id]?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSection, goToSection]);

  const favoriteNav = SETTINGS_NAV.filter((n) => favorites.includes(n.id));
  const recentNav = SETTINGS_NAV.filter(
    (n) => recentSections.includes(n.id) && !favorites.includes(n.id),
  ).slice(0, 4);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex min-h-0 w-[200px] shrink-0 flex-col border-r border-border bg-surface-0/40">
        <div className="sticky top-0 z-sticky border-b border-border p-2">
          <InputGroup className="h-8 border-border bg-surface-2">
            <InputGroupAddon
              align="inline-start"
              className="pl-2.5 text-[var(--text-tertiary)]"
            >
              <Search className="h-3.5 w-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  pushSearchHistory(searchQuery.trim());
                  if (searchHits[0]) {
                    goToSection(searchHits[0].section);
                    requestAnimationFrame(() => {
                      document
                        .getElementById(searchHits[0].id)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    });
                  }
                }
                if (e.key === "Escape") {
                  if (searchQuery) e.preventDefault();
                  setSearchQuery("");
                }
              }}
              placeholder="Search settings"
              className="h-8 type-caption"
              aria-label="Search settings"
            />
            {searchQuery && (
              <InputGroupButton
                data-align="inline-end"
                size="icon-xs"
                className="mr-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X />
              </InputGroupButton>
            )}
          </InputGroup>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav className="p-1.5" aria-label="Settings categories">
            {favoriteNav.length > 0 && (
              <NavGroup label="Favorites">
                {favoriteNav.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeSection === item.id}
                    favorited
                    buttonRef={(el) => {
                      if (el) navRefs.current[item.id] = el;
                    }}
                    onSelect={() => goToSection(item.id)}
                    onToggleFavorite={() => toggleFavorite(item.id)}
                  />
                ))}
              </NavGroup>
            )}
            {recentNav.length > 0 && !searchQuery && (
              <NavGroup label="Recent">
                {recentNav.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeSection === item.id}
                    buttonRef={(el) => {
                      if (el) navRefs.current[item.id] = el;
                    }}
                    onSelect={() => goToSection(item.id)}
                    onToggleFavorite={() => toggleFavorite(item.id)}
                  />
                ))}
              </NavGroup>
            )}
            <NavGroup label="Categories">
              {SETTINGS_NAV.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={activeSection === item.id}
                  favorited={favorites.includes(item.id)}
                  buttonRef={(el) => {
                    if (el) navRefs.current[item.id] = el;
                  }}
                  onSelect={() => goToSection(item.id)}
                  onToggleFavorite={() => toggleFavorite(item.id)}
                />
              ))}
            </NavGroup>
          </nav>
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 type-caption text-muted-foreground">
          <Breadcrumb>
            <BreadcrumbList className="gap-1 type-caption sm:gap-1.5">
              <BreadcrumbItem>
                <span className="text-muted-foreground">Settings</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-muted-foreground/40">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage className="font-medium text-foreground/90">
                  {navItem?.label}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto h-7 w-7"
            onClick={() => toggleFavorite(activeSection)}
            aria-label="Toggle favorite"
          >
            <Star
              className={cn(
                "h-3.5 w-3.5",
                favorites.includes(activeSection) && "fill-accent text-accent",
              )}
            />
          </Button>
        </div>

        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-y-auto p-5"
          key={searchQuery.trim() ? "search" : activeSection}
        >
          {searchQuery.trim() ? (
            <div>
              <h2 className="mb-3 type-body-sm font-semibold text-[var(--text-primary)]">
                Results for &ldquo;{searchQuery}&rdquo;
              </h2>
              {searchHits.length === 0 ? (
                <p className="type-caption text-[var(--text-tertiary)]">No settings found.</p>
              ) : (
                <div className="space-y-1" role="listbox" aria-label="Search results">
                  {searchHits.map((hit) => (
                    <Button
                      key={hit.id}
                      type="button"
                      role="option"
                      variant="ghost"
                      onClick={() => {
                        const q = searchQuery;
                        goToSection(hit.section);
                        pushSearchHistory(q);
                        requestAnimationFrame(() => {
                          document.getElementById(hit.id)?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        });
                      }}
                      className="h-auto w-full flex-col items-start gap-0.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      <span className="type-caption text-[var(--text-primary)]">
                        {highlightMatch(hit.title, searchQuery)}
                      </span>
                      <span className="type-caption text-[var(--text-tertiary)]">
                        {SETTINGS_NAV.find((n) => n.id === hit.section)?.label}
                        {hit.description ? ` · ${hit.description}` : ""}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Page />
          )}
        </div>
      </div>
    </div>
  );
}

function NavGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1 type-caption-uppercase text-[var(--text-tertiary)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function NavButton({
  item,
  active,
  favorited,
  onSelect,
  onToggleFavorite,
  buttonRef,
}: {
  item: (typeof SETTINGS_NAV)[0];
  active: boolean;
  favorited?: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = item.icon;
  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
        active
          ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        ref={buttonRef}
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left type-caption font-normal text-inherit hover:bg-transparent hover:text-inherit focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border-focus)]"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{item.label}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="mr-1 opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={favorited ? "Remove favorite" : "Add favorite"}
      >
        <Star
          className={cn(
            "h-3 w-3",
            favorited && "fill-accent text-accent opacity-100",
          )}
        />
      </Button>
    </div>
  );
}
