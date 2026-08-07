import OutputTabs from "@/components/output/OutputTabs";

/** Center editor region — browser, code editor, and terminal output tabs */
export default function EditorArea() {
  return (
    <div className="h-full min-w-0 bg-surface-0">
      <OutputTabs />
    </div>
  );
}
