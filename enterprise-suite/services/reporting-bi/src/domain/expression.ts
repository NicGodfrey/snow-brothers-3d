/**
 * The tiny expression language used by derived (calculated) metrics.
 *
 *   gross_margin_pct  =  safe_div(gross_profit, net_revenue) * 100
 *   aov               =  safe_div(net_revenue, order_count)
 *   scrap_rate        =  safe_div(scrap_qty, scrap_qty + good_qty)
 *
 * Grammar (recursive descent, standard precedence):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := '-' unary | primary
 *   primary    := NUMBER | IDENT | IDENT '(' args ')' | '(' expression ')'
 *
 * Semantics follow SQL rather than JavaScript: values are `number | null`,
 * null propagates through every arithmetic operator, and division by zero
 * yields null instead of Infinity/NaN. A dashboard tile showing an empty
 * cell for "no orders yet" is correct; one showing `Infinity` is a bug.
 *
 * Identifiers resolve to other metric values in the same group. The parser
 * is deliberately closed: no member access, no indexing, no assignment, so a
 * stored expression can never reach outside the metric namespace.
 */
import { ExpressionError } from "./errors.js";

export type MetricValue = number | null;

export type Expression =
  | { readonly kind: "literal"; readonly value: number }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "unary"; readonly op: "-"; readonly operand: Expression }
  | {
      readonly kind: "binary";
      readonly op: "+" | "-" | "*" | "/";
      readonly left: Expression;
      readonly right: Expression;
    }
  | { readonly kind: "call"; readonly name: FunctionName; readonly args: readonly Expression[] };

export type FunctionName =
  | "abs"
  | "coalesce"
  | "least"
  | "greatest"
  | "max"
  | "min"
  | "pow"
  | "round"
  | "safe_div"
  | "sqrt";

interface FunctionSpec {
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly apply: (args: readonly MetricValue[]) => MetricValue;
}

const nonNull = (args: readonly MetricValue[]): number[] =>
  args.filter((a): a is number => a !== null);

const FUNCTIONS: Record<FunctionName, FunctionSpec> = {
  abs: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([v]) => (v === null || v === undefined ? null : Math.abs(v)),
  },
  coalesce: {
    minArgs: 1,
    maxArgs: 16,
    apply: (args) => args.find((a) => a !== null) ?? null,
  },
  least: {
    minArgs: 1,
    maxArgs: 16,
    apply: (args) => {
      const values = nonNull(args);
      return values.length === 0 ? null : Math.min(...values);
    },
  },
  greatest: {
    minArgs: 1,
    maxArgs: 16,
    apply: (args) => {
      const values = nonNull(args);
      return values.length === 0 ? null : Math.max(...values);
    },
  },
  min: {
    minArgs: 1,
    maxArgs: 16,
    apply: (args) => {
      const values = nonNull(args);
      return values.length === 0 ? null : Math.min(...values);
    },
  },
  max: {
    minArgs: 1,
    maxArgs: 16,
    apply: (args) => {
      const values = nonNull(args);
      return values.length === 0 ? null : Math.max(...values);
    },
  },
  pow: {
    minArgs: 2,
    maxArgs: 2,
    apply: ([base, exponent]) => {
      if (base === null || base === undefined || exponent === null || exponent === undefined) return null;
      const result = Math.pow(base, exponent);
      return Number.isFinite(result) ? result : null;
    },
  },
  round: {
    minArgs: 1,
    maxArgs: 2,
    apply: ([value, decimals]) => {
      if (value === null || value === undefined) return null;
      const places = decimals === null || decimals === undefined ? 0 : Math.trunc(decimals);
      const factor = Math.pow(10, Math.max(0, Math.min(10, places)));
      return Math.round(value * factor) / factor;
    },
  },
  safe_div: {
    minArgs: 2,
    maxArgs: 2,
    apply: ([numerator, denominator]) => {
      if (numerator === null || numerator === undefined) return null;
      if (denominator === null || denominator === undefined || denominator === 0) return null;
      const result = numerator / denominator;
      return Number.isFinite(result) ? result : null;
    },
  },
  sqrt: {
    minArgs: 1,
    maxArgs: 1,
    apply: ([v]) => (v === null || v === undefined || v < 0 ? null : Math.sqrt(v)),
  },
};

export const FUNCTION_NAMES: readonly FunctionName[] = Object.keys(FUNCTIONS) as FunctionName[];

function isFunctionName(name: string): name is FunctionName {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = "number" | "ident" | "operator" | "lparen" | "rparen" | "comma" | "eof";

interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly position: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_.]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      while (i < source.length && /[0-9._]/.test(source[i]!)) i += 1;
      const text = source.slice(start, i).replace(/_/g, "");
      if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(text)) {
        throw new ExpressionError(`malformed number '${text}'`, start);
      }
      tokens.push({ type: "number", text, position: start });
      continue;
    }
    if (IDENT_START.test(char)) {
      while (i < source.length && IDENT_BODY.test(source[i]!)) i += 1;
      tokens.push({ type: "ident", text: source.slice(start, i), position: start });
      continue;
    }
    i += 1;
    switch (char) {
      case "+":
      case "-":
      case "*":
      case "/":
        tokens.push({ type: "operator", text: char, position: start });
        break;
      case "(":
        tokens.push({ type: "lparen", text: char, position: start });
        break;
      case ")":
        tokens.push({ type: "rparen", text: char, position: start });
        break;
      case ",":
        tokens.push({ type: "comma", text: char, position: start });
        break;
      default:
        throw new ExpressionError(`unexpected character '${char}'`, start);
    }
  }
  tokens.push({ type: "eof", text: "", position: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    const token = this.tokens[this.index]!;
    if (token.type !== "eof") this.index += 1;
    return token;
  }

  private expect(type: TokenType, description: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ExpressionError(
        `expected ${description} but found ${token.type === "eof" ? "end of expression" : `'${token.text}'`}`,
        token.position,
      );
    }
    return this.next();
  }

  parse(): Expression {
    const expression = this.parseExpression();
    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw new ExpressionError(`unexpected trailing input '${trailing.text}'`, trailing.position);
    }
    return expression;
  }

  private parseExpression(): Expression {
    let left = this.parseTerm();
    while (this.peek().type === "operator" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.next().text as "+" | "-";
      left = { kind: "binary", op, left, right: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): Expression {
    let left = this.parseUnary();
    while (this.peek().type === "operator" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.next().text as "*" | "/";
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expression {
    const token = this.peek();
    if (token.type === "operator" && token.text === "-") {
      this.next();
      return { kind: "unary", op: "-", operand: this.parseUnary() };
    }
    if (token.type === "operator" && token.text === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.next();
    switch (token.type) {
      case "number":
        return { kind: "literal", value: Number(token.text) };
      case "ident": {
        if (this.peek().type === "lparen") {
          const name = token.text.toLowerCase();
          if (!isFunctionName(name)) {
            throw new ExpressionError(
              `unknown function '${token.text}' (available: ${FUNCTION_NAMES.join(", ")})`,
              token.position,
            );
          }
          this.next();
          const args: Expression[] = [];
          if (this.peek().type !== "rparen") {
            args.push(this.parseExpression());
            while (this.peek().type === "comma") {
              this.next();
              args.push(this.parseExpression());
            }
          }
          this.expect("rparen", "')'");
          const spec = FUNCTIONS[name];
          if (args.length < spec.minArgs || args.length > spec.maxArgs) {
            const arity =
              spec.minArgs === spec.maxArgs
                ? `${spec.minArgs}`
                : `${spec.minArgs}..${spec.maxArgs}`;
            throw new ExpressionError(
              `${name}() takes ${arity} argument(s), got ${args.length}`,
              token.position,
            );
          }
          return { kind: "call", name, args };
        }
        return { kind: "reference", name: token.text };
      }
      case "lparen": {
        const inner = this.parseExpression();
        this.expect("rparen", "')'");
        return inner;
      }
      default:
        throw new ExpressionError(
          token.type === "eof"
            ? "unexpected end of expression"
            : `unexpected token '${token.text}'`,
          token.position,
        );
    }
  }
}

const parseCache = new Map<string, Expression>();

export function parseExpression(source: string): Expression {
  const trimmed = source.trim();
  if (!trimmed) throw new ExpressionError("expression is empty");
  const cached = parseCache.get(trimmed);
  if (cached) return cached;
  const parsed = new Parser(tokenize(trimmed)).parse();
  parseCache.set(trimmed, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Analysis & evaluation
// ---------------------------------------------------------------------------

/** Distinct identifiers referenced by an expression, in first-seen order. */
export function referencedNames(expression: Expression): string[] {
  const names: string[] = [];
  const walk = (node: Expression): void => {
    switch (node.kind) {
      case "reference":
        if (!names.includes(node.name)) names.push(node.name);
        break;
      case "unary":
        walk(node.operand);
        break;
      case "binary":
        walk(node.left);
        walk(node.right);
        break;
      case "call":
        for (const arg of node.args) walk(arg);
        break;
      case "literal":
        break;
    }
  };
  walk(expression);
  return names;
}

export interface EvaluationScope {
  /** Returns the value bound to a name, or undefined when unbound. */
  resolve(name: string): MetricValue | undefined;
}

export function scopeOf(values: Readonly<Record<string, MetricValue>>): EvaluationScope {
  return {
    resolve: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined),
  };
}

export function evaluate(expression: Expression, scope: EvaluationScope): MetricValue {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "reference": {
      const value = scope.resolve(expression.name);
      if (value === undefined) {
        throw new ExpressionError(`unresolved metric reference '${expression.name}'`);
      }
      return value;
    }
    case "unary": {
      const operand = evaluate(expression.operand, scope);
      return operand === null ? null : -operand;
    }
    case "binary": {
      const left = evaluate(expression.left, scope);
      const right = evaluate(expression.right, scope);
      if (left === null || right === null) return null;
      switch (expression.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/": {
          if (right === 0) return null;
          const result = left / right;
          return Number.isFinite(result) ? result : null;
        }
      }
    }
    case "call": {
      const args = expression.args.map((arg) => evaluate(arg, scope));
      return FUNCTIONS[expression.name].apply(args);
    }
  }
}

/** Renders an AST back to canonical source (round-trips through the parser). */
export function unparse(expression: Expression): string {
  switch (expression.kind) {
    case "literal":
      return String(expression.value);
    case "reference":
      return expression.name;
    case "unary":
      return `-${unparse(expression.operand)}`;
    case "binary":
      return `(${unparse(expression.left)} ${expression.op} ${unparse(expression.right)})`;
    case "call":
      return `${expression.name}(${expression.args.map(unparse).join(", ")})`;
  }
}
