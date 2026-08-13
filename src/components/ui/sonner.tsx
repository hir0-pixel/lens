import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Dark-first toaster for Lens (no next-themes dependency). */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface-2 group-[.toaster]:text-zinc-100 group-[.toaster]:border-white/10 group-[.toaster]:shadow-float-pop",
          description: "group-[.toast]:text-zinc-500",
          actionButton:
            "group-[.toast]:bg-accent group-[.toast]:text-surface-0",
          cancelButton:
            "group-[.toast]:bg-white/10 group-[.toast]:text-zinc-300",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
