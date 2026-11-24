import { Link } from "react-router-dom";
import { promptOwners, type PromptOwner } from "../shared/prompt-library";

export function PromptLibraryLink({owner, source}: {owner: string; source: string}) {
 if (!promptOwners.includes(owner as PromptOwner)) return null;
 return <Link className="inline-flex text-body-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2" to={`/prompts?owner=${encodeURIComponent(owner)}&q=${encodeURIComponent(source)}`}>查看并整理提示词</Link>;
}
