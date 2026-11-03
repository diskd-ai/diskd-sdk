import {
  Err,
  formatInboxMessageSearchQuery,
  type InboxFolderScope,
  type InboxSearchQuery,
  type InboxSearchQueryError,
  Ok,
  type Option,
  parseInboxSearchQuery,
  type Result,
} from './inboxSearchQuery.js';

/** REQ-3623-001: AND/OR combine existing typed predicates without changing the string wire contract. */
export type InboxSearchExpression =
  | { readonly tag: 'Criteria'; readonly criteria: InboxSearchQuery }
  | { readonly tag: 'And' | 'Or'; readonly operands: readonly InboxSearchExpression[] };
export type ParsedInboxSearchExpression = {
  readonly expression: InboxSearchExpression;
  readonly folderScope: InboxFolderScope;
};
type Token = { readonly tag: 'Term' | 'And' | 'Or' | 'Open' | 'Close'; readonly text: string };
type RawExpression =
  | { readonly tag: 'Terms'; readonly terms: readonly string[] }
  | { readonly tag: 'And' | 'Or'; readonly operands: readonly RawExpression[] };
type ParsedNode = { readonly node: RawExpression; readonly next: number };
const invalid = (reason: string): Result<InboxSearchQueryError, never> =>
  Err({ tag: 'InvalidExpression', reason });

/** REQ-3623-002: quotes and embedded balanced punctuation stay literal; group delimiters remain syntax. */
function tokenize(query: string): Result<InboxSearchQueryError, readonly Token[]> {
  const tokens: Token[] = [];
  let term = '';
  let quoted = false;
  let literalDepth = 0;
  const flush = (): void => {
    if (term.length === 0) return;
    tokens.push({ tag: term === 'AND' ? 'And' : term === 'OR' ? 'Or' : 'Term', text: term });
    term = '';
  };
  for (const char of query) {
    if (char === '"') {
      quoted = !quoted;
      term += char;
      continue;
    }
    if (quoted) {
      term += char;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (
      char === '(' &&
      (term.length === 0 ||
        term === 'AND' ||
        term === 'OR' ||
        /^[A-Za-z][A-Za-z0-9_-]*:$/.test(term))
    ) {
      flush();
      tokens.push({ tag: 'Open', text: char });
      continue;
    }
    if (char === '(') literalDepth += 1;
    if (char === ')') {
      if (literalDepth > 0) literalDepth -= 1;
      else {
        flush();
        tokens.push({ tag: 'Close', text: char });
        continue;
      }
    }
    term += char;
  }
  if (quoted) return invalid('quoted literal is missing its closing quote');
  if (literalDepth !== 0) return invalid('literal parentheses must balance or be quoted');
  flush();
  if (tokens.some((token) => token.text === '""'))
    return invalid('quoted literal requires a value');
  if (
    tokens.some(
      (token) =>
        token.text.includes('"') && !/^(?:[A-Za-z][A-Za-z0-9_-]*:)?"[^"]*"$/.test(token.text)
    )
  ) {
    return invalid('quotes must enclose a whole term or operator value');
  }
  return tokens.length === 0 ? Err({ tag: 'EmptyQuery' }) : Ok(tokens);
}

/** REQ-3623-001: recursive descent gives AND precedence over OR without expanding combinations. */
function parseTokens(tokens: readonly Token[]): Result<InboxSearchQueryError, RawExpression> {
  const primary = (
    start: number,
    scope: string,
    depth: number
  ): Result<InboxSearchQueryError, ParsedNode> => {
    if (depth > 32) return invalid('group nesting exceeds 32');
    const token = tokens[start];
    if (!token) return invalid('expected a criterion');
    if (token.tag === 'Open') {
      const inner = disjunction(start + 1, scope, depth + 1);
      if (inner.tag === 'Err') return inner;
      if (tokens[inner.value.next]?.tag !== 'Close')
        return invalid('group is missing its closing parenthesis');
      return Ok({ node: inner.value.node, next: inner.value.next + 1 });
    }
    if (token.tag !== 'Term') return invalid(`expected a criterion before ${token.text}`);
    if (/^[A-Za-z][A-Za-z0-9_-]*:$/.test(token.text) && tokens[start + 1]?.tag === 'Open') {
      if (scope) return invalid('nested field scopes are ambiguous');
      if (/^(folder|recursive):$/i.test(token.text))
        return invalid('folder routing requires one selector');
      return primary(start + 1, token.text, depth + 1);
    }
    const terms: string[] = [];
    let next = start;
    while (tokens[next]?.tag === 'Term') {
      const text = tokens[next].text;
      if (
        next > start &&
        /^[A-Za-z][A-Za-z0-9_-]*:$/.test(text) &&
        tokens[next + 1]?.tag === 'Open'
      )
        break;
      if (scope && /^[A-Za-z][A-Za-z0-9_-]*:/.test(text))
        return invalid('a scoped group accepts values only');
      terms.push(scope + text);
      next += 1;
      if (scope) break;
    }
    return Ok({ node: { tag: 'Terms', terms }, next });
  };
  const conjunction = (
    start: number,
    scope: string,
    depth: number
  ): Result<InboxSearchQueryError, ParsedNode> => {
    const first = primary(start, scope, depth);
    if (first.tag === 'Err') return first;
    const operands = [first.value.node];
    let next = first.value.next;
    while (tokens[next] && tokens[next].tag !== 'Or' && tokens[next].tag !== 'Close') {
      if (tokens[next].tag === 'And') next += 1;
      const part = primary(next, scope, depth);
      if (part.tag === 'Err') return part;
      operands.push(part.value.node);
      next = part.value.next;
    }
    return Ok({ node: operands.length === 1 ? operands[0] : { tag: 'And', operands }, next });
  };
  const disjunction = (
    start: number,
    scope: string,
    depth: number
  ): Result<InboxSearchQueryError, ParsedNode> => {
    const first = conjunction(start, scope, depth);
    if (first.tag === 'Err') return first;
    const operands = [first.value.node];
    let next = first.value.next;
    while (tokens[next]?.tag === 'Or') {
      const part = conjunction(next + 1, scope, depth);
      if (part.tag === 'Err') return part;
      operands.push(part.value.node);
      next = part.value.next;
    }
    return Ok({ node: operands.length === 1 ? operands[0] : { tag: 'Or', operands }, next });
  };
  const parsed = disjunction(0, '', 0);
  if (parsed.tag === 'Err') return parsed;
  return parsed.value.next === tokens.length
    ? Ok(parsed.value.node)
    : invalid('unexpected closing parenthesis');
}

/** REQ-3623-003: folder routing is global and may appear only in unconditional conjunctions. */
export function parseInboxSearchExpression(
  query: string
): Result<InboxSearchQueryError, ParsedInboxSearchExpression> {
  const tokens = tokenize(query);
  if (tokens.tag === 'Err') return tokens;
  const raw = parseTokens(tokens.value);
  if (raw.tag === 'Err') return raw;
  const routing: string[] = [];
  const convert = (
    node: RawExpression,
    unconditional: boolean
  ): Result<InboxSearchQueryError, InboxSearchExpression> => {
    if (node.tag === 'Terms') {
      const terms: string[] = [];
      for (const term of node.terms) {
        if (/^(folder|recursive):/i.test(term)) {
          if (!unconditional)
            return invalid(
              'folder: and recursive: must apply to the whole query, outside OR alternatives'
            );
          routing.push(term);
        } else terms.push(term);
      }
      if (terms.length === 0) return Ok({ tag: 'And', operands: [] });
      const parsed = parseInboxSearchQuery(terms.join(' '));
      return parsed.tag === 'Err' ? parsed : Ok({ tag: 'Criteria', criteria: parsed.value });
    }
    const operands: InboxSearchExpression[] = [];
    for (const operand of node.operands) {
      const parsed = convert(operand, unconditional && node.tag === 'And');
      if (parsed.tag === 'Err') return parsed;
      if (parsed.value.tag === 'And' && parsed.value.operands.length === 0) continue;
      operands.push(parsed.value);
    }
    return Ok(operands.length === 1 ? operands[0] : { tag: node.tag, operands });
  };
  const expression = convert(raw.value, true);
  if (expression.tag === 'Err') return expression;
  if (routing.length === 0)
    return Ok({ expression: expression.value, folderScope: { tag: 'AllFolders' } });
  const scope = parseInboxSearchQuery(routing.join(' '));
  return scope.tag === 'Err'
    ? scope
    : Ok({ expression: expression.value, folderScope: scope.value.folderScope });
}

/** REQ-3623-004: callers match their owned message shape through the same Boolean structure. */
export function evaluateInboxSearchExpression(
  expression: InboxSearchExpression,
  matches: (criteria: InboxSearchQuery) => boolean
): boolean {
  switch (expression.tag) {
    case 'Criteria':
      return matches(expression.criteria);
    case 'And':
      return expression.operands.every((operand) =>
        evaluateInboxSearchExpression(operand, matches)
      );
    case 'Or':
      return expression.operands.some((operand) => evaluateInboxSearchExpression(operand, matches));
  }
}

/** REQ-3623-003: canonical parentheses preserve semantics when forwarding to the storage owner. */
export function formatInboxMessageSearchExpression(
  expression: InboxSearchExpression
): Option<string> {
  if (expression.tag === 'Criteria') return formatInboxMessageSearchQuery(expression.criteria);
  const parts = expression.operands
    .map(formatInboxMessageSearchExpression)
    .flatMap((value) => (value.tag === 'Some' ? [value.value] : []));
  return parts.length === 0
    ? { tag: 'None' }
    : { tag: 'Some', value: `(${parts.join(expression.tag === 'And' ? ' AND ' : ' OR ')})` };
}
