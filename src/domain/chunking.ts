export type ChunkInput = {
  title: string;
  memoryType: string;
  markdown: string;
};

export type ChunkOutput = {
  chunkIndex: number;
  headingPath: string;
  content: string;
  tokenEstimate: number;
};

const TARGET_TOKENS = 320;
const OVERLAP_TOKENS = 64;
const HARD_CAP_TOKENS = 480;

export function chunkMarkdown(input: ChunkInput): ChunkOutput[] {
  const sections = splitIntoSections(input.markdown);
  const chunks: ChunkOutput[] = [];
  let activeParagraphs: string[] = [];
  let activeHeading = "";

  function flush() {
    if (activeParagraphs.length === 0) {
      return;
    }
    const content = buildChunkContent(
      input.title,
      input.memoryType,
      activeHeading,
      activeParagraphs,
    );
    chunks.push({
      chunkIndex: chunks.length,
      headingPath: activeHeading,
      content,
      tokenEstimate: estimateTokens(content),
    });
    activeParagraphs = retainOverlap(activeParagraphs);
  }

  for (const section of sections) {
    activeHeading = section.headingPath;
    for (const paragraph of section.paragraphs) {
      if (!paragraph.trim()) {
        continue;
      }
      const candidate = [...activeParagraphs, paragraph];
      const candidateContent = buildChunkContent(
        input.title,
        input.memoryType,
        section.headingPath,
        candidate,
      );
      const candidateTokens = estimateTokens(candidateContent);
      if (candidateTokens > TARGET_TOKENS && activeParagraphs.length > 0) {
        flush();
      }

      activeHeading = section.headingPath;
      const limitedParagraphs = splitParagraphToFit(
        input.title,
        input.memoryType,
        section.headingPath,
        paragraph,
      );
      for (const part of limitedParagraphs) {
        trimOverlapToFit(
          input.title,
          input.memoryType,
          activeHeading,
          activeParagraphs,
          part,
        );
        activeParagraphs.push(part);
        const size = estimateTokens(
          buildChunkContent(input.title, input.memoryType, activeHeading, activeParagraphs),
        );
        if (size >= TARGET_TOKENS) {
          flush();
        }
      }
    }
  }

  flush();
  return chunks;
}

function splitIntoSections(markdown: string) {
  const lines = markdown.split("\n");
  const stack: string[] = [];
  const sections: { headingPath: string; paragraphs: string[] }[] = [];
  let paragraphBuffer: string[] = [];

  function pushParagraph() {
    if (paragraphBuffer.length === 0) {
      return;
    }
    const current = getCurrentSection();
    current.paragraphs.push(paragraphBuffer.join("\n").trim());
    paragraphBuffer = [];
  }

  function getCurrentSection() {
    const headingPath = stack.join(" > ");
    let current = sections.at(-1);
    if (!current || current.headingPath !== headingPath) {
      current = { headingPath, paragraphs: [] };
      sections.push(current);
    }
    return current;
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      pushParagraph();
      const depth = headingMatch[1].length;
      stack.length = depth - 1;
      stack[depth - 1] = headingMatch[2].trim();
      getCurrentSection();
      continue;
    }

    if (line.trim() === "") {
      pushParagraph();
      continue;
    }
    paragraphBuffer.push(line);
  }

  pushParagraph();
  return sections.length > 0 ? sections : [{ headingPath: "", paragraphs: [markdown.trim()] }];
}

function splitParagraphToFit(
  title: string,
  memoryType: string,
  headingPath: string,
  paragraph: string,
) {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (
    estimateTokens(buildChunkContent(title, memoryType, headingPath, [paragraph])) <= HARD_CAP_TOKENS
  ) {
    return [paragraph];
  }

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < words.length) {
    const slice: string[] = [];
    while (cursor < words.length) {
      slice.push(words[cursor]);
      const candidate = slice.join(" ");
      if (
        estimateTokens(buildChunkContent(title, memoryType, headingPath, [candidate])) >
        HARD_CAP_TOKENS
      ) {
        slice.pop();
        break;
      }
      cursor += 1;
    }
    if (slice.length === 0) {
      slice.push(words[cursor]);
      cursor += 1;
    }
    parts.push(slice.join(" "));
  }
  return parts;
}

function buildChunkContent(
  title: string,
  memoryType: string,
  headingPath: string,
  paragraphs: string[],
) {
  const header = [`Title: ${title}`, `Type: ${memoryType}`];
  if (headingPath) {
    header.push(`Heading: ${headingPath}`);
  }
  return `${header.join("\n")}\n\n${paragraphs.join("\n\n")}`.trim();
}

function retainOverlap(paragraphs: string[]) {
  const overlap: string[] = [];
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    overlap.unshift(paragraphs[index]);
    const joined = overlap.join("\n\n");
    if (estimateTokens(joined) >= OVERLAP_TOKENS) {
      break;
    }
  }
  return overlap;
}

function trimOverlapToFit(
  title: string,
  memoryType: string,
  headingPath: string,
  activeParagraphs: string[],
  nextParagraph: string,
) {
  while (
    activeParagraphs.length > 0 &&
    estimateTokens(
      buildChunkContent(title, memoryType, headingPath, [...activeParagraphs, nextParagraph]),
    ) > HARD_CAP_TOKENS
  ) {
    activeParagraphs.shift();
  }
}

export function estimateTokens(text: string) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.2);
}
