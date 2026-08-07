import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import GithubIcon from "@/components/ui/GithubIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGitStore } from "@/stores/gitStore";
import { cn } from "@/lib/utils";

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "github" || provider === "local") {
    return <GithubIcon className="h-3.5 w-3.5" />;
  }
  return (
    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-orange-500/20 text-[8px] font-bold text-orange-400">
      {provider.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function RepositorySelector() {
  const repositories = useGitStore((s) => s.repositories);
  const activeRepoId = useGitStore((s) => s.activeRepoId);
  const setActiveRepo = useGitStore((s) => s.setActiveRepo);
  const lastFetchAt = useGitStore((s) => s.lastFetchAt);
  const repo = repositories.find((r) => r.id === activeRepoId) ?? repositories[0];

  return (
    <div className="border-b border-white/5 px-2 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-full justify-between gap-2 px-2 text-[12px] font-normal text-zinc-300 hover:bg-white/5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ProviderIcon provider={repo.provider} />
              <span className="truncate">{repo.name}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] text-zinc-500">
            Repositories
          </DropdownMenuLabel>
          {repositories.map((r) => (
            <DropdownMenuItem key={r.id} onClick={() => setActiveRepo(r.id)}>
              <ProviderIcon provider={r.provider} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px]">{r.name}</div>
                <div className="truncate text-[10px] text-zinc-600">{r.path}</div>
              </div>
              {r.id === activeRepoId && <Check className="h-3.5 w-3.5 text-accent" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-zinc-500">
            Clone Repository…
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="text-zinc-500">
            Open Repository…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mt-1 flex items-center justify-between px-2 text-[10px] text-zinc-600">
        <span className={cn("capitalize")}>{repo.provider}</span>
        <span>Fetched {lastFetchAt ?? "never"}</span>
      </div>
    </div>
  );
}
