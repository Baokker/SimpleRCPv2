import { useLayoutEffect, useRef, useState } from "react";

export function ReadableText({ text, testId }: { text: string; testId?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const formatted = text.trim().replace(/([。！？；])\s*(?=\S)/g, "$1\n");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [formatted, expanded]);
  return <div className="conflict-readable"><p ref={ref} className={expanded ? "expanded" : "collapsed"} data-testid={testId}>{formatted}</p>{overflowing ? <button className="conflict-text-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</button> : null}</div>;
}
