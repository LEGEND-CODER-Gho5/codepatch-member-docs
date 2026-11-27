import { parseRules } from "@/lib/site-rules";

/** Renders the policies and procedures. Text only; the administrator's input is never treated as HTML. */
export function RulesText({ text }: { text: string }) {
  const blocks = parseRules(text);
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-zinc-700">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3 key={index} className="pt-3 text-[15px] font-semibold text-zinc-950 first:pt-0">
              {block.text}
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-1.5 pl-5 [list-style:disc] marker:text-brand-400">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
