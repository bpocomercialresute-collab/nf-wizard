import { defineMcp } from "@lovable.dev/mcp-js";
import buildFilenameTool from "./tools/build-filename";
import listPatternTokensTool from "./tools/list-pattern-tokens";

export default defineMcp({
  name: "nf-renamer-tool",
  title: "NF Renamer Tool",
  version: "0.1.0",
  instructions:
    "Ferramentas do NF Renamer para nomear arquivos de notas fiscais. Use `list_pattern_tokens` para descobrir os tokens disponíveis e `build_filename` para gerar o nome final a partir de um padrão e dos dados da nota.",
  tools: [listPatternTokensTool, buildFilenameTool],
});
