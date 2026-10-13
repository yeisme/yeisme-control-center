import { useEffect, useState, type ComponentType } from "react";
import { Star, MoreHorizontal, ArrowUp, ArrowDown } from "./icons";
import { DropdownMenu } from "./ui";
export interface NavigationItem {
  id: string;
  label: string;
  group: string;
  icon: ComponentType<{ size?: number }>;
}
function readPreference(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
export function NavigationSidebar({
  items,
  page,
  onNavigate,
  identity = "demo",
}: {
  items: NavigationItem[];
  page: string;
  onNavigate: (page: string) => void;
  identity?: string;
}) {
  const key = "yeisme.navigation.v6." + identity;
  const [favorites, setFavorites] = useState(() =>
    readPreference(key + ".favorites"),
  );
  const [order, setOrder] = useState(() => readPreference(key + ".order"));
  useEffect(() => {
    setFavorites(readPreference(key + ".favorites"));
    setOrder(readPreference(key + ".order"));
  }, [key]);
  const sorted = [...items].sort(
    (a, b) =>
      (order.includes(a.id) ? order.indexOf(a.id) : 999) -
      (order.includes(b.id) ? order.indexOf(b.id) : 999),
  );
  const save = (kind: "favorites" | "order", value: string[]) => {
    (kind === "favorites" ? setFavorites : setOrder)(value);
    try {
      localStorage.setItem(key + "." + kind, JSON.stringify(value));
    } catch {
      /* Browser preferences are optional. */
    }
  };
  const move = (index: number, direction: number) => {
    const next = sorted.map((n) => n.id),
      target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    save("order", next);
  };
  return (
    <nav aria-label="控制中心导航" className="navigation-tree">
      <div className="nav-group">
        {sorted.map((n, index) => (
          <div className="nav-row" key={n.id}>
            <button
              className={`nav-item ${page === n.id ? "active" : ""}`}
              title={n.label}
              aria-label={n.label}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => onNavigate(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {favorites.includes(n.id) && (
                <Star className="nav-favorite" size={12} />
              )}
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className="nav-options"
                aria-label={n.label + "导航选项"}
              >
                <MoreHorizontal size={14} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="admin-menu"
                  side="right"
                  align="start"
                >
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={() =>
                      save(
                        "favorites",
                        favorites.includes(n.id)
                          ? favorites.filter((id) => id !== n.id)
                          : [...favorites, n.id],
                      )
                    }
                  >
                    <Star size={14} />
                    {favorites.includes(n.id) ? "取消收藏入口" : "收藏入口"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={index === 0}
                    onSelect={() => move(index, -1)}
                  >
                    <ArrowUp size={14} />
                    上移
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={index === sorted.length - 1}
                    onSelect={() => move(index, 1)}
                  >
                    <ArrowDown size={14} />
                    下移
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ))}
      </div>
    </nav>
  );
}
