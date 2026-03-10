import express from "express";
import supabase from "../../config/db.js";
import { auth } from "../../middleware/auth.middleware.js";
import { applyAcademyFilter } from "../../middleware/academyFilter.js";

const router = express.Router();

function getRoleName(req) {
  return req.user?.role || req.user?.role_name || null;
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function normalizeInteger(value, fieldName, { required = false, min = 1, max = null } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    throw new Error(`${fieldName} must be a whole number`);
  }

  if (numericValue < min) {
    throw new Error(`${fieldName} must be at least ${min}`);
  }

  if (max !== null && numericValue > max) {
    throw new Error(`${fieldName} must be at most ${max}`);
  }

  return numericValue;
}

function normalizeAmount(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }

    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`${fieldName} must be a valid amount`);
  }

  return Number(numericValue.toFixed(2));
}

function resolveScopedAcademyId(value, req, { required = true } = {}) {
  const requestAcademyId = normalizeInteger(value, "academy_id", { required: false });
  const userAcademyId = normalizeInteger(req.user?.academy_id, "academy_id", { required: false });
  const roleName = getRoleName(req);

  if (roleName === "super_admin") {
    if (!requestAcademyId && required) {
      throw new Error("academy_id is required");
    }

    return requestAcademyId;
  }

  if (!userAcademyId && required) {
    throw new Error("academy_id is required");
  }

  if (requestAcademyId && userAcademyId && requestAcademyId !== userAcademyId) {
    const error = new Error("You cannot manage invoices for another academy");
    error.statusCode = 403;
    throw error;
  }

  return userAcademyId;
}

function getMonthName(month, year) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric"
  });
}

function calculateInvoiceDueDate({ invoiceYear, invoiceMonth, dueDay, graceDays }) {
  const day = Math.max(1, Math.min(Number(dueDay || 5), 31));
  const invoiceDate = new Date(invoiceYear, invoiceMonth - 1, 1);
  const dueDate = new Date(invoiceYear, invoiceMonth - 1, day);

  if (dueDate.getMonth() !== invoiceDate.getMonth()) {
    dueDate.setDate(0);
  }

  if ((graceDays || 0) > 0) {
    dueDate.setDate(dueDate.getDate() + Number(graceDays || 0));
  }

  return dueDate.toISOString().slice(0, 10);
}

function calculateInvoiceStatus({ totalAmount, paidAmount, currentStatus }) {
  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);

  if (currentStatus === "cancelled") {
    return "cancelled";
  }

  if (paid <= 0) {
    return currentStatus === "draft" ? "draft" : "issued";
  }

  if (paid >= total) {
    return "paid";
  }

  return "partial";
}

function canOverrideInvoices(req) {
  const roleName = String(getRoleName(req) || "").toLowerCase();
  return roleName === "super_admin" || roleName === "academy_admin" || roleName === "head_coach";
}

async function enrichInvoices(invoices) {
  const invoiceRows = invoices || [];
  const playerIds = [...new Set(invoiceRows.map((invoice) => invoice.player_id).filter(Boolean))];
  const categoryIds = [...new Set(invoiceRows.map((invoice) => invoice.category_id).filter(Boolean))];
  const feePlanIds = [...new Set(invoiceRows.map((invoice) => invoice.category_fee_plan_id).filter(Boolean))];
  const academyIds = [...new Set(invoiceRows.map((invoice) => invoice.academy_id).filter(Boolean))];
  const invoiceIds = [...new Set(invoiceRows.map((invoice) => invoice.id).filter(Boolean))];

  const [playersResponse, categoriesResponse, plansResponse, academiesResponse, paymentsResponse] =
    await Promise.all([
      playerIds.length
        ? supabase.from("players").select("id,name").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
      categoryIds.length
        ? supabase.from("categories").select("id,name").in("id", categoryIds)
        : Promise.resolve({ data: [], error: null }),
      feePlanIds.length
        ? supabase.from("category_fee_plans").select("id,plan_name").in("id", feePlanIds)
        : Promise.resolve({ data: [], error: null }),
      academyIds.length
        ? supabase.from("academies").select("id,name").in("id", academyIds)
        : Promise.resolve({ data: [], error: null }),
      invoiceIds.length
        ? supabase.from("invoice_payments").select("id,invoice_id,amount_paid").in("invoice_id", invoiceIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (playersResponse.error) {
    throw playersResponse.error;
  }

  if (categoriesResponse.error) {
    throw categoriesResponse.error;
  }

  if (plansResponse.error) {
    throw plansResponse.error;
  }

  if (academiesResponse.error) {
    throw academiesResponse.error;
  }

  if (paymentsResponse.error) {
    throw paymentsResponse.error;
  }

  const playerMap = new Map((playersResponse.data || []).map((player) => [String(player.id), player.name]));
  const categoryMap = new Map((categoriesResponse.data || []).map((category) => [String(category.id), category.name]));
  const feePlanMap = new Map((plansResponse.data || []).map((plan) => [String(plan.id), plan.plan_name]));
  const academyMap = new Map((academiesResponse.data || []).map((academy) => [String(academy.id), academy.name]));
  const paymentTotals = new Map();

  (paymentsResponse.data || []).forEach((payment) => {
    const key = String(payment.invoice_id);
    paymentTotals.set(key, (paymentTotals.get(key) || 0) + Number(payment.amount_paid || 0));
  });

  return invoiceRows.map((invoice) => {
    const paidAmount = Number(paymentTotals.get(String(invoice.id)) || 0);
    const totalAmount = Number(invoice.total_amount || 0);

    return {
      ...invoice,
      player_name: playerMap.get(String(invoice.player_id)) || null,
      category_name: categoryMap.get(String(invoice.category_id)) || null,
      fee_plan_name: feePlanMap.get(String(invoice.category_fee_plan_id)) || null,
      academy_name: academyMap.get(String(invoice.academy_id)) || null,
      paid_amount: Number(paidAmount.toFixed(2)),
      balance_amount: Number(Math.max(totalAmount - paidAmount, 0).toFixed(2)),
      status: calculateInvoiceStatus({
        totalAmount,
        paidAmount,
        currentStatus: invoice.status
      }),
      billing_label: getMonthName(invoice.invoice_month, invoice.invoice_year)
    };
  });
}

router.get("/", auth, async (req, res) => {
  try {
    let query = supabase
      .from("invoices")
      .select("*")
      .order("invoice_year", { ascending: false })
      .order("invoice_month", { ascending: false })
      .order("created_at", { ascending: false });
    query = applyAcademyFilter(query, req);

    const month = normalizeInteger(req.query.month, "month", { required: false, min: 1, max: 12 });
    const year = normalizeInteger(req.query.year, "year", { required: false, min: 2000, max: 2100 });
    const status = normalizeText(req.query.status);
    const playerId = normalizeInteger(req.query.player_id, "player_id", { required: false });

    if (month) {
      query = query.eq("invoice_month", month);
    }

    if (year) {
      query = query.eq("invoice_year", year);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (playerId) {
      query = query.eq("player_id", playerId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const enrichedInvoices = await enrichInvoices(data || []);
    res.json(enrichedInvoices);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/generate-monthly", auth, async (req, res) => {
  try {
    const academyId = resolveScopedAcademyId(req.body.academy_id, req, { required: true });
    const invoiceMonth = normalizeInteger(req.body.invoice_month, "invoice_month", {
      required: true,
      min: 1,
      max: 12
    });
    const invoiceYear = normalizeInteger(req.body.invoice_year, "invoice_year", {
      required: true,
      min: 2000,
      max: 2100
    });
    const invoiceDate =
      normalizeText(req.body.invoice_date) || `${invoiceYear}-${String(invoiceMonth).padStart(2, "0")}-01`;

    const [playersResponse, plansResponse, overridesResponse, existingInvoicesResponse] = await Promise.all([
      supabase
        .from("players")
        .select("id,academy_id,category_id,name,status")
        .eq("academy_id", academyId)
        .eq("status", "active"),
      supabase
        .from("category_fee_plans")
        .select("*")
        .eq("academy_id", academyId)
        .eq("status", "active"),
      supabase
        .from("player_fee_overrides")
        .select("*")
        .eq("academy_id", academyId)
        .eq("status", "active"),
      supabase
        .from("invoices")
        .select("id,player_id,status")
        .eq("academy_id", academyId)
        .eq("invoice_month", invoiceMonth)
        .eq("invoice_year", invoiceYear)
    ]);

    if (playersResponse.error) {
      return res.status(500).json({ error: playersResponse.error.message });
    }

    if (plansResponse.error) {
      return res.status(500).json({ error: plansResponse.error.message });
    }

    if (overridesResponse.error) {
      return res.status(500).json({ error: overridesResponse.error.message });
    }

    if (existingInvoicesResponse.error) {
      return res.status(500).json({ error: existingInvoicesResponse.error.message });
    }

    const players = playersResponse.data || [];
    const activePlans = plansResponse.data || [];
    const activeOverrides = overridesResponse.data || [];
    const existingInvoices = existingInvoicesResponse.data || [];

    const existingPlayerIds = new Set(
      existingInvoices
        .filter((invoice) => String(invoice.status || "").toLowerCase() !== "cancelled")
        .map((invoice) => String(invoice.player_id))
    );

    const planByCategory = new Map(activePlans.map((plan) => [String(plan.category_id), plan]));
    const overrideByPlayer = new Map();

    activeOverrides.forEach((override) => {
      const startDate = override.start_date ? new Date(override.start_date) : null;
      const endDate = override.end_date ? new Date(override.end_date) : null;
      const targetDate = new Date(invoiceYear, invoiceMonth - 1, 1);

      if (startDate && targetDate < startDate) {
        return;
      }

      if (endDate && targetDate > endDate) {
        return;
      }

      overrideByPlayer.set(String(override.player_id), override);
    });

    const invoiceRows = [];
    const skipped = [];

    players.forEach((player) => {
      if (existingPlayerIds.has(String(player.id))) {
        skipped.push({
          player_id: player.id,
          player_name: player.name,
          reason: "invoice_already_exists"
        });
        return;
      }

      const override = overrideByPlayer.get(String(player.id)) || null;
      const plan = override ? null : planByCategory.get(String(player.category_id)) || null;
      const amount = override ? Number(override.amount || 0) : Number(plan?.amount || 0);

      if (!(amount > 0)) {
        skipped.push({
          player_id: player.id,
          player_name: player.name,
          reason: override ? "invalid_override_amount" : "no_active_category_fee_plan"
        });
        return;
      }

      invoiceRows.push({
        academy_id: academyId,
        player_id: player.id,
        category_id: player.category_id,
        category_fee_plan_id: plan?.id || null,
        invoice_month: invoiceMonth,
        invoice_year: invoiceYear,
        invoice_date: invoiceDate,
        due_date: calculateInvoiceDueDate({
          invoiceYear,
          invoiceMonth,
          dueDay: plan?.due_day || 5,
          graceDays: plan?.grace_days || 0
        }),
        calculated_amount: amount,
        amount,
        override_amount: null,
        override_reason: null,
        override_updated_by: null,
        discount_amount: 0,
        late_fee_amount: 0,
        total_amount: amount,
        status: "issued",
        notes: override
          ? `Generated from player fee override for ${player.name}`
          : `Generated from category fee plan for ${player.name}`
      });
    });

    let insertedInvoices = [];

    if (invoiceRows.length) {
      const { data, error } = await supabase.from("invoices").insert(invoiceRows).select("*");

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      insertedInvoices = data || [];
    }

    const enrichedInserted = await enrichInvoices(insertedInvoices);

    res.status(201).json({
      academy_id: academyId,
      invoice_month: invoiceMonth,
      invoice_year: invoiceYear,
      generated_count: enrichedInserted.length,
      skipped_count: skipped.length,
      generated_invoices: enrichedInserted,
      skipped
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    let query = supabase.from("invoices").select("*").eq("id", req.params.id);
    query = applyAcademyFilter(query, req);

    const { data: existingInvoice, error: existingError } = await query.maybeSingle();

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (!existingInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const notes = normalizeText(req.body.notes);
    const discountAmount = normalizeAmount(req.body.discount_amount, "discount_amount", { required: false });
    const lateFeeAmount = normalizeAmount(req.body.late_fee_amount, "late_fee_amount", { required: false });
    const requestedStatus = normalizeText(req.body.status);
    const overrideAmount = normalizeAmount(req.body.override_amount, "override_amount", { required: false });
    const overrideReason = normalizeText(req.body.override_reason);

    if (overrideAmount !== null && !canOverrideInvoices(req)) {
      return res.status(403).json({ error: "You do not have permission to override invoice amounts" });
    }

    const baseCalculatedAmount = Number(
      existingInvoice.calculated_amount ?? existingInvoice.amount ?? 0
    );
    const nextAmount = overrideAmount !== null ? overrideAmount : Number(existingInvoice.amount || 0);
    const nextDiscount = discountAmount ?? Number(existingInvoice.discount_amount || 0);
    const nextLateFee = lateFeeAmount ?? Number(existingInvoice.late_fee_amount || 0);
    const nextTotal = Number(Math.max(nextAmount - nextDiscount + nextLateFee, 0).toFixed(2));

    const { data: payments, error: paymentError } = await supabase
      .from("invoice_payments")
      .select("amount_paid")
      .eq("invoice_id", existingInvoice.id);

    if (paymentError) {
      return res.status(500).json({ error: paymentError.message });
    }

    const paidAmount = (payments || []).reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
    const nextStatus =
      requestedStatus ||
      calculateInvoiceStatus({
        totalAmount: nextTotal,
        paidAmount,
        currentStatus: existingInvoice.status
      });

    const { data, error } = await supabase
      .from("invoices")
      .update({
        calculated_amount: baseCalculatedAmount,
        discount_amount: nextDiscount,
        late_fee_amount: nextLateFee,
        amount: nextAmount,
        override_amount:
          overrideAmount !== null
            ? overrideAmount
            : existingInvoice.override_amount ?? null,
        override_reason:
          overrideAmount !== null
            ? overrideReason
            : existingInvoice.override_reason ?? null,
        override_updated_by:
          overrideAmount !== null
            ? normalizeInteger(req.user?.id, "user_id", { required: false })
            : existingInvoice.override_updated_by ?? null,
        total_amount: nextTotal,
        status: nextStatus,
        notes: notes ?? existingInvoice.notes,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingInvoice.id)
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const [enrichedInvoice] = await enrichInvoices([data]);
    res.json(enrichedInvoice);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

export default router;
