/**
 * The subscriber filter model.
 *
 * Substack's own dashboard encodes a filter by gluing an operator suffix onto
 * the column name: `num_comments_gt`, `user_email_address_similar_to`,
 * `subscription_created_at_gte`. That is fine for a UI that knows the mapping
 * and hostile to anything constructing it blind, because the suffix depends on
 * the column's type and several suffixes read nothing like the operator they
 * implement.
 *
 * So callers name a column and an intent (`is_not`, `is_before`, `contains`)
 * and the suffix is derived here from the column's type. A wrong operator for a
 * column is refused with the valid list rather than sent upstream to become an
 * opaque 400.
 */

export type ColumnType =
  | "Int"
  | "String"
  | "DateTime"
  | "Array"
  | "subscription_type"
  | "group_membership";

export type Operator =
  | "is" | "is_not" | "gt" | "gte" | "lt" | "lte"
  | "is_any_of" | "contains" | "starts_with" | "ends_with"
  | "is_on" | "is_after" | "is_on_or_after" | "is_before" | "is_on_or_before"
  | "includes_any" | "includes_all" | "includes_none";

/** Column type to the operators it accepts, and the suffix each one sends. */
export const OPERATORS_BY_TYPE: Record<ColumnType, Partial<Record<Operator, string>>> = {
  Int: {
    is: "",
    is_not: "_distinct_from",
    gt: "_gt",
    gte: "_gte",
    lt: "_lt",
    lte: "_lte",
  },
  String: {
    is: "_string_is",
    is_not: "_string_not",
    is_any_of: "_in",
    contains: "_similar_to",
    starts_with: "_starts_with",
    ends_with: "_ends_with",
    includes_none: "_includes_none",
  },
  DateTime: {
    is_on: "_is_on",
    is_after: "_gt",
    is_on_or_after: "_gte",
    is_before: "_lt",
    is_on_or_before: "_is_on_or_before",
  },
  Array: {
    includes_any: "_includes_any",
    includes_all: "_includes_all",
    includes_none: "_includes_none",
  },
  subscription_type: {
    is: "",
    is_not: "_not",
    is_any_of: "_in",
  },
  group_membership: {
    is: "",
    is_not: "_distinct_from",
    is_any_of: "_in",
  },
};

/** Operators whose value must be a list. Anything else must be a scalar. */
export const LIST_OPERATORS = new Set<Operator>([
  "is_any_of",
  "includes_any",
  "includes_all",
  "includes_none",
]);

export const SUBSCRIPTION_TYPES = [
  "paid", "free", "founding", "comp", "gift", "free_trial", "iap",
] as const;

export const GROUP_MEMBERSHIPS = ["none", "member", "admin"] as const;

export type ColumnSpec = {
  type: ColumnType;
  /** What the Substack dashboard calls it, which is how a caller will refer to it. */
  label: string;
  values?: readonly string[];
  /** Filterable but not exportable. Substack drops these from a CSV silently. */
  exportable?: boolean;
};

export const SUBSCRIBER_COLUMNS: Record<string, ColumnSpec> = {
  // Identity
  user_name: { type: "String", label: "Name" },
  user_email_address: { type: "String", label: "Email" },
  country: { type: "String", label: "Country" },
  state: { type: "String", label: "State/Province" },
  group_membership: {
    type: "group_membership",
    label: "Group membership",
    values: GROUP_MEMBERSHIPS,
    exportable: false,
  },

  // Subscription
  subscription_type: {
    type: "subscription_type",
    label: "Type",
    values: SUBSCRIPTION_TYPES,
  },
  subscription_created_at: { type: "DateTime", label: "Start date" },
  subscription_expires_at: { type: "DateTime", label: "Expiration date" },
  first_payment_at: { type: "DateTime", label: "First paid date" },
  last_subscribed_at: { type: "DateTime", label: "Paid upgrade date" },
  unsubscribed_at: { type: "DateTime", label: "Cancel date" },
  subscription_interval: { type: "String", label: "Subscription interval" },
  stripe_plan_name: { type: "String", label: "Stripe plan" },
  free_attribution: { type: "String", label: "Subscription source (free)" },
  paid_attribution: { type: "String", label: "Subscription source (paid)" },
  is_subscribed: { type: "Int", label: "Can see paid content" },
  bestseller_tier: { type: "Int", label: "Bestseller" },
  total_revenue_generated: { type: "Int", label: "Revenue" },
  num_subs_gifted: { type: "Int", label: "Subscriptions gifted" },
  bundle_id: { type: "Int", label: "Bundle" },
  is_bundle_parent: { type: "Int", label: "Bundle origin" },

  // Email engagement
  num_emails_received: { type: "Int", label: "Emails received (6mo)" },
  num_emails_dropped: { type: "Int", label: "Emails dropped (6mo)" },
  num_email_opens: { type: "Int", label: "Emails opened (6mo)" },
  num_email_opens_last_7d: { type: "Int", label: "Emails opened (7d)" },
  num_email_opens_last_30d: { type: "Int", label: "Emails opened (30d)" },
  num_unique_email_posts_seen: { type: "Int", label: "Unique emails seen (6mo)" },
  num_unique_email_posts_seen_last_7d: { type: "Int", label: "Unique emails seen (7d)" },
  num_unique_email_posts_seen_last_30d: { type: "Int", label: "Unique emails seen (30d)" },
  last_opened_at: { type: "DateTime", label: "Last email open" },
  links_clicked: { type: "Int", label: "Links clicked" },
  last_clicked_at: { type: "DateTime", label: "Last clicked at" },
  emails_enabled: { type: "Array", label: "Sections" },

  // Site engagement
  num_web_post_views: { type: "Int", label: "Post views" },
  num_web_post_views_last_7d: { type: "Int", label: "Post views (7d)" },
  num_web_post_views_last_30d: { type: "Int", label: "Post views (30d)" },
  num_unique_web_posts_seen: { type: "Int", label: "Unique posts seen" },
  num_unique_web_posts_seen_last_7d: { type: "Int", label: "Unique posts seen (7d)" },
  num_unique_web_posts_seen_last_30d: { type: "Int", label: "Unique posts seen (30d)" },
  num_comments: { type: "Int", label: "Comments" },
  num_comments_last_7d: { type: "Int", label: "Comments (7d)" },
  num_comments_last_30d: { type: "Int", label: "Comments (30d)" },
  num_shares: { type: "Int", label: "Shares" },
  num_shares_last_7d: { type: "Int", label: "Shares (7d)" },
  num_shares_last_30d: { type: "Int", label: "Shares (30d)" },
  days_active_last_30d: { type: "Int", label: "Days active (30d)" },
  activity_rating: { type: "Int", label: "Activity" },

  tag_ids: { type: "Array", label: "Tags", exportable: false },
};

export const COLUMN_NAMES = Object.keys(SUBSCRIBER_COLUMNS);

/** Columns Substack will actually put in a CSV export. */
export const EXPORTABLE_COLUMNS = COLUMN_NAMES.filter(
  (name) => SUBSCRIBER_COLUMNS[name]!.exportable !== false,
);

export type Filter = {
  column: string;
  operator: Operator;
  value: unknown;
};

function describe(column: string): string {
  const spec = SUBSCRIBER_COLUMNS[column];
  return spec ? `"${column}" (${spec.label})` : `"${column}"`;
}

function resolveSuffix(column: string, operator: Operator): string {
  const spec = SUBSCRIBER_COLUMNS[column];
  if (!spec) {
    throw new Error(
      `Unknown subscriber column "${column}". Valid columns: ${COLUMN_NAMES.join(", ")}`,
    );
  }

  const operators = OPERATORS_BY_TYPE[spec.type];
  const suffix = operators[operator];
  if (suffix === undefined) {
    throw new Error(
      `Operator "${operator}" does not apply to ${describe(column)}, which is a ${spec.type} column. Valid operators for it: ${Object.keys(operators).join(", ")}`,
    );
  }
  return suffix;
}

function validateValue(column: string, operator: Operator, value: unknown): void {
  const spec = SUBSCRIBER_COLUMNS[column]!;
  const wantsList = LIST_OPERATORS.has(operator);
  const isList = Array.isArray(value);

  if (wantsList && !isList) {
    throw new Error(
      `Operator "${operator}" on ${describe(column)} takes a list of values, not a single one.`,
    );
  }
  if (!wantsList && isList) {
    throw new Error(
      `Operator "${operator}" on ${describe(column)} takes a single value, not a list.`,
    );
  }

  if (spec.values) {
    const given = isList ? (value as unknown[]) : [value];
    for (const item of given) {
      if (!spec.values.includes(String(item))) {
        throw new Error(
          `"${String(item)}" is not a valid value for ${describe(column)}. Valid values: ${spec.values.join(", ")}`,
        );
      }
    }
  }

  if (spec.type === "DateTime" && !isList) {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `${describe(column)} needs a date. "${String(value)}" did not parse. Use YYYY-MM-DD or a full ISO timestamp.`,
      );
    }
  }
}

/**
 * Build the request body Substack expects.
 *
 * Conditions combine with AND. There is no OR and no nesting, which is a limit
 * of the endpoint rather than of this code: anything needing OR has to be
 * issued as separate calls and merged by the caller.
 */
export function buildQuery(options: {
  filters?: Filter[];
  search?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}): Record<string, unknown> {
  const built: Record<string, unknown> = {};

  for (const { column, operator, value } of options.filters ?? []) {
    const suffix = resolveSuffix(column, operator);
    validateValue(column, operator, value);
    const key = `${column}${suffix}`;

    // Two conditions reducing to the same key would silently collapse into one,
    // quietly dropping a filter the caller asked for.
    if (Object.prototype.hasOwnProperty.call(built, key)) {
      throw new Error(
        `Duplicate filter: ${describe(column)} already has an "${operator}" condition. Use one condition per column and operator.`,
      );
    }
    built[key] = value;
  }

  // A top-level `search` is ignored by the endpoint. It only works inside filters.
  if (options.search) built.search = options.search;

  if (options.sortBy) {
    if (!SUBSCRIBER_COLUMNS[options.sortBy]) {
      throw new Error(
        `Unknown column "${options.sortBy}" for sort_by. Valid columns: ${COLUMN_NAMES.join(", ")}`,
      );
    }
    const key =
      options.sortDirection === "asc" ? "order_by" : "order_by_desc_nulls_last";
    built[key] = options.sortBy;
  }

  return {
    filters: built,
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
  };
}

/** A compact reference for the tool description, so a model does not guess names. */
export function columnReference(): string {
  return COLUMN_NAMES.map((name) => {
    const spec = SUBSCRIBER_COLUMNS[name]!;
    return `${name} (${spec.type}, "${spec.label}")`;
  }).join("; ");
}
