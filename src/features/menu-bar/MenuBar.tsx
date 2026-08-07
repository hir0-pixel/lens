import { Fragment } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_BAR, type MenuCommand } from "./menuRegistry";

/**
 * Native-style application menu bar — opens on click, hover between menus,
 * nested submenus, shortcuts, disabled items, separators.
 */
export function MenuBar({
  menus = MENU_BAR,
}: {
  menus?: typeof MENU_BAR;
}) {
  return (
    <nav className="flex h-full items-stretch" aria-label="Application menu" role="menubar">
      {menus.map((menu) => (
        <DropdownMenu key={menu.id}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              className={cn(
                "px-2 text-[13px] text-[var(--cursor-title-fg)] outline-none",
                "transition-colors duration-[100ms] ease-[cubic-bezier(0.33,1,0.68,1)]",
                "hover:bg-[var(--cursor-list-hover)]",
                "focus-visible:bg-[var(--cursor-list-hover)]",
                "data-[state=open]:bg-[var(--cursor-list-hover)]",
              )}
            >
              {menu.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            className="min-w-[240px] rounded-none border-[var(--cursor-border)] bg-[var(--cursor-menu-bg,#1f1f1f)] p-0 text-[13px] shadow-[var(--shadow-overlay)] animate-cursor-fade"
          >
            {menu.items.map((item) => (
              <MenuItemRow key={item.id} item={item} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </nav>
  );
}

function MenuItemRow({ item }: { item: MenuCommand }) {
  if (item.separator) {
    return <DropdownMenuSeparator className="my-0 bg-[var(--cursor-border)]" />;
  }

  if (item.submenu?.length) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          disabled={item.disabled}
          className="h-[26px] rounded-none px-3 text-[13px] focus:bg-[var(--cursor-focus)] focus:text-white data-[state=open]:bg-[var(--cursor-focus)] data-[state=open]:text-white"
        >
          {item.icon && (
            <item.icon className="mr-2 h-3.5 w-3.5 opacity-80" strokeWidth={1.5} />
          )}
          <span className="flex-1">{item.label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[200px] rounded-none border-[var(--cursor-border)] bg-[var(--cursor-menu-bg,#1f1f1f)] p-0 text-[13px]">
          {item.submenu.map((sub) => (
            <Fragment key={sub.id}>
              {sub.separator ? (
                <DropdownMenuSeparator className="bg-[var(--cursor-border)]" />
              ) : (
                <DropdownMenuItem
                  disabled={sub.disabled}
                  onSelect={() => sub.action?.()}
                  className="h-[26px] rounded-none px-3 focus:bg-[var(--cursor-focus)] focus:text-white"
                >
                  {sub.icon && (
                    <sub.icon className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  <span className="flex-1">{sub.label}</span>
                  {sub.shortcut && (
                    <span className="ml-6 text-[11px] text-[var(--cursor-fg-muted)]">
                      {sub.shortcut}
                    </span>
                  )}
                </DropdownMenuItem>
              )}
            </Fragment>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuItem
      disabled={item.disabled}
      onSelect={() => item.action?.()}
      className="h-[26px] gap-0 rounded-none px-3 text-[13px] focus:bg-[var(--cursor-focus)] focus:text-white data-[disabled]:opacity-40"
    >
      {item.icon ? (
        <item.icon className="mr-2 h-3.5 w-3.5 opacity-80" strokeWidth={1.5} />
      ) : (
        <span className="mr-2 w-3.5" />
      )}
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <span className="ml-8 text-[11px] tabular-nums text-[var(--cursor-fg-muted)] group-focus:text-white/80">
          {item.shortcut}
        </span>
      )}
    </DropdownMenuItem>
  );
}
