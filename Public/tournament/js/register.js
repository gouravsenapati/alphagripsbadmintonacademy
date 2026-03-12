import { publicTournamentApi } from "./services/publicTournamentApi.js";

const state = {
  tournamentLookup: new URLSearchParams(window.location.search).get("tournament") || "",
  overview: null,
  options: [],
  selectedEventId: "",
  form: {
    player_name: "",
    age: "",
    gender: "Boys",
    email: "",
    phone_number: "",
    parent_name: "",
    partner_name: "",
    payment_method: "online",
    notes: "",
    payment_proof_url: ""
  },
  paymentProofName: "",
  loading: true,
  submitting: false,
  paymentProcessing: false,
  paymentProcessingStep: "",
  error: "",
  success: null
};

const TOURNAMENT_HUB_URL = "/Public/tournament.html#tournamentList";

function getApp() {
  return document.getElementById("registrationApp");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatDate(value) {
  if (!value) {
    return "Dates to be confirmed";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getTournament() {
  return state.overview?.tournament || null;
}

function getPaymentConfig() {
  return getTournament()?.payment_config || {};
}

function getSelectedEvent() {
  return state.options.find((option) => option.event_id === state.selectedEventId) || null;
}

function getGenderLabelFromEvent(event) {
  const gender = String(event?.gender || "").trim().toLowerCase();
  if (gender === "female" || gender === "girls") {
    return "Girls";
  }
  if (gender === "male" || gender === "boys") {
    return "Boys";
  }
  return state.form.gender || "Boys";
}

function setField(name, value) {
  state.form[name] = value;
}

function formatMoney(value) {
  const numeric = Number(value || 0);
  return `Rs ${numeric.toFixed(2)}`;
}

function getPaymentMethodLabel(value) {
  if (value === "online") {
    return "Online Payment";
  }
  if (value === "upi") {
    return "Manual UPI";
  }
  if (value === "bank_transfer") {
    return "Bank Transfer";
  }
  if (value === "cash") {
    return "Legacy Cash";
  }
  return "Pending";
}

function renderStatus() {
  if (state.paymentProcessing) {
    const isVerifying = state.paymentProcessingStep === "verifying";

    return `
      <div class="registration-status processing">
        <strong>${escapeHtml(
          isVerifying ? "Payment verification in progress" : "Preparing secure payment"
        )}</strong>
        <span>
          ${escapeHtml(
            isVerifying
              ? "Please wait while we confirm your Razorpay payment and finalize the registration. Do not refresh or close this page."
              : "Please wait while Razorpay checkout opens. Do not refresh this page."
          )}
        </span>
      </div>
    `;
  }

  if (state.error) {
    return `<div class="registration-status error">${escapeHtml(state.error)}</div>`;
  }

  if (state.success?.message) {
    return `<div class="registration-status success">${escapeHtml(state.success.message)}</div>`;
  }

  return "";
}

function renderSelectedEventSummary() {
  const event = getSelectedEvent();

  if (!event) {
    return `
      <div class="registration-empty">
        Choose an event to see the registration fee and payment details.
      </div>
    `;
  }

  const gstNote =
    event.fee_type === "exclusive_gst"
      ? `Base ${formatMoney(event.registration_fee)} + GST ${escapeHtml(
          String(event.gst_percent)
        )}%`
      : `Amount includes GST (${escapeHtml(String(event.gst_percent))}%)`;

  return `
    <section class="selected-event-summary">
      <div>
        <p class="registration-kicker">Selected Event</p>
        <h3>${escapeHtml(event.event_name)}</h3>
        <p class="registration-note">
          ${escapeHtml(event.age_group || "-")} • ${escapeHtml(event.gender || "-")} •
          ${escapeHtml(event.entry_type)}
        </p>
      </div>
      <div class="selected-event-pricing">
        <div class="price-box">
          <span>Registration Fee</span>
          <strong>${formatMoney(event.payable_amount)}</strong>
        </div>
        <div class="price-meta">
          <span class="registration-chip">${escapeHtml(
            event.fee_type === "exclusive_gst" ? "GST extra" : "GST included"
          )}</span>
          <p>${escapeHtml(gstNote)}</p>
        </div>
      </div>
    </section>
  `;
}

function renderSuccessCard() {
  if (!state.success?.registration) {
    return "";
  }

  const registration = state.success.registration;
  const event = registration.event || {};
  const pricing = state.success.pricing || null;

  return `
    <section class="registration-success-card">
      <p class="registration-kicker">Registration Submitted</p>
      <h2>${escapeHtml(registration.player_name)} has been submitted successfully.</h2>
      <p class="registration-summary-meta">
        Event: ${escapeHtml(event.event_name || "-")} •
        Payment status: ${escapeHtml(registration.payment_status)} •
        Payment method: ${escapeHtml(getPaymentMethodLabel(registration.payment_method))} •
        Registration ID: ${escapeHtml(registration.id)}
      </p>
      ${
        pricing
          ? `
              <div class="registration-entry-item">
                <strong>Payable:</strong> ${escapeHtml(formatMoney(pricing.payable_amount))}
                <span> • ${escapeHtml(pricing.fee_type === "exclusive_gst" ? "GST extra" : "GST included")}</span>
              </div>
            `
          : ""
      }
    </section>
  `;
}

function renderPaymentHelp() {
  const selectedEvent = getSelectedEvent();
  const payableAmount = selectedEvent?.payable_amount || 0;
  const method = state.form.payment_method;
  const paymentConfig = getPaymentConfig();

  if (!selectedEvent) {
    return "";
  }

  if (method === "online") {
    return `
      <div class="registration-help-card">
        <p class="registration-kicker">Online Payment</p>
        <h3>Pay ${escapeHtml(formatMoney(payableAmount))} with Razorpay</h3>
        <p>After submission, Razorpay checkout will open for the online payment methods enabled in your current Razorpay setup.</p>
      </div>
    `;
  }

  if (method === "upi") {
    const hasUpiQr = hasText(paymentConfig.upi_qr_url);
    const hasUpiId = hasText(paymentConfig.upi_id);

    return `
      <div class="registration-help-card">
        <p class="registration-kicker">Manual UPI</p>
        <h3>Pay ${escapeHtml(formatMoney(payableAmount))} using UPI QR</h3>
        <p>Scan the QR or use the UPI ID below, complete the transfer, then upload payment proof for desk verification.</p>
        ${
          hasUpiQr || hasUpiId
            ? `
                <div class="payment-instructions">
                  ${
                    hasUpiQr
                      ? `
                          <div class="payment-qr-card">
                            <p class="registration-kicker">UPI QR</p>
                            <img
                              class="payment-qr-image"
                              src="${escapeHtml(paymentConfig.upi_qr_url)}"
                              alt="UPI QR code"
                            />
                          </div>
                        `
                      : ""
                  }
                  <div class="payment-details-card">
                    ${
                      hasUpiId
                        ? `
                            <div class="payment-detail-row">
                              <span>UPI ID</span>
                              <strong>${escapeHtml(paymentConfig.upi_id)}</strong>
                            </div>
                          `
                        : ""
                    }
                    ${
                      hasText(paymentConfig.payment_note)
                        ? `<p class="registration-note">${escapeHtml(paymentConfig.payment_note)}</p>`
                        : ""
                    }
                  </div>
                </div>
              `
            : `
                <p class="registration-note">
                  UPI QR and UPI ID will be shared by the tournament desk. Upload the payment proof after transfer.
                </p>
              `
        }
      </div>
    `;
  }

  if (method === "bank_transfer") {
    const hasBankAccount = hasText(paymentConfig.account_number);

    return `
      <div class="registration-help-card">
        <p class="registration-kicker">Bank Transfer</p>
        <h3>Pay ${escapeHtml(formatMoney(payableAmount))} by bank transfer</h3>
        <p>Use the bank details below, then upload the payment screenshot for desk verification.</p>
        ${
          hasBankAccount
            ? `
                <div class="payment-instructions">
                  <div class="payment-details-card">
                    ${
                      hasText(paymentConfig.account_name)
                        ? `
                            <div class="payment-detail-row">
                              <span>Account Name</span>
                              <strong>${escapeHtml(paymentConfig.account_name)}</strong>
                            </div>
                          `
                        : ""
                    }
                    ${
                      hasText(paymentConfig.bank_name)
                        ? `
                            <div class="payment-detail-row">
                              <span>Bank</span>
                              <strong>${escapeHtml(paymentConfig.bank_name)}</strong>
                            </div>
                          `
                        : ""
                    }
                    ${
                      hasBankAccount
                        ? `
                            <div class="payment-detail-row">
                              <span>Account Number</span>
                              <strong>${escapeHtml(paymentConfig.account_number)}</strong>
                            </div>
                          `
                        : ""
                    }
                    ${
                      hasText(paymentConfig.ifsc)
                        ? `
                            <div class="payment-detail-row">
                              <span>IFSC</span>
                              <strong>${escapeHtml(paymentConfig.ifsc)}</strong>
                            </div>
                          `
                        : ""
                    }
                    ${
                      hasText(paymentConfig.payment_note)
                        ? `<p class="registration-note">${escapeHtml(paymentConfig.payment_note)}</p>`
                        : ""
                    }
                  </div>
                </div>
              `
            : `
                <p class="registration-note">
                  Bank account details will be shared by the tournament desk. Upload the proof after completing the transfer.
                </p>
              `
        }
      </div>
    `;
  }

  return "";
}

function renderForm() {
  const tournament = getTournament();
  const selectedEvent = getSelectedEvent();

  return `
    <section class="registration-shell">
      <section class="registration-hero">
        <div>
          <p class="registration-kicker">Tournament Registration</p>
          <h1>${escapeHtml(tournament?.tournament_name || "Register for Tournament")}</h1>
          <p>
            Register one event at a time. Only categories opened by the tournament desk appear below,
            and the registration fee is shown directly from the live tournament setup.
          </p>
          <p class="registration-note">
            ${escapeHtml(formatDate(tournament?.start_date))} - ${escapeHtml(
              formatDate(tournament?.end_date)
            )}
            ${
              hasText(tournament?.venue_name) || hasText(tournament?.city)
                ? ` • ${escapeHtml(
                    [tournament?.venue_name, tournament?.city, tournament?.country]
                      .filter(hasText)
                      .join(", ")
                  )}`
                : ""
            }
          </p>
        </div>
        <div class="registration-hero-actions">
          <a class="registration-btn secondary" href="${TOURNAMENT_HUB_URL}">Back to Tournament Hub</a>
          ${
            state.tournamentLookup
              ? `<a class="registration-btn ghost" href="/Public/tournament/viewer.html?tournament=${encodeURIComponent(
                  state.tournamentLookup
                )}">Open Viewer</a>`
              : ""
          }
        </div>
      </section>

      ${renderStatus()}

      <section class="registration-panel">
        <div class="registration-toolbar">
          <div>
            <p class="registration-kicker">Player Registration</p>
            <h2 class="registration-section-title">Register for one event</h2>
          </div>
          <span class="registration-chip">${escapeHtml(
            `${state.options.length} live registration event${state.options.length === 1 ? "" : "s"}`
          )}</span>
        </div>

        <form id="registrationForm">
          <div class="registration-grid">
            <div class="registration-field span-2">
              <label for="event_id">Event</label>
              <select id="event_id" name="event_id" required>
                <option value="">Select event</option>
                ${state.options
                  .map(
                    (event) => `
                      <option value="${escapeHtml(event.event_id)}" ${
                        state.selectedEventId === event.event_id ? "selected" : ""
                      }>
                        ${escapeHtml(event.event_name)} - ${escapeHtml(event.fee_label)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </div>

            <div class="registration-field">
              <label for="player_name">${
                selectedEvent?.entry_type === "doubles" ? "Player 1 Name" : "Player Name"
              }</label>
              <input id="player_name" name="player_name" type="text" value="${escapeHtml(
                state.form.player_name
              )}" required />
            </div>

            <div class="registration-field">
              <label for="age">Age</label>
              <input id="age" name="age" type="number" min="1" max="99" value="${escapeHtml(
                state.form.age
              )}" required />
            </div>

            <div class="registration-field">
              <label for="gender">Gender Category</label>
              <select id="gender" name="gender">
                <option value="Girls" ${state.form.gender === "Girls" ? "selected" : ""}>Girls</option>
                <option value="Boys" ${state.form.gender === "Boys" ? "selected" : ""}>Boys</option>
              </select>
            </div>

            <div class="registration-field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" value="${escapeHtml(
                state.form.email
              )}" required />
            </div>

            <div class="registration-field">
              <label for="phone_number">Phone Number</label>
              <input id="phone_number" name="phone_number" type="text" value="${escapeHtml(
                state.form.phone_number
              )}" />
            </div>

            <div class="registration-field">
              <label for="parent_name">Parent / Guardian Name</label>
              <input id="parent_name" name="parent_name" type="text" value="${escapeHtml(
                state.form.parent_name
              )}" />
            </div>

            <div class="registration-field">
              <label for="payment_method">Payment Method</label>
              <select id="payment_method" name="payment_method">
                <option value="online" ${
                  state.form.payment_method === "online" ? "selected" : ""
                }>Online Payment</option>
                <option value="upi" ${
                  state.form.payment_method === "upi" ? "selected" : ""
                }>Manual UPI QR</option>
                <option value="bank_transfer" ${
                  state.form.payment_method === "bank_transfer" ? "selected" : ""
                }>Bank Transfer</option>
              </select>
            </div>

            ${
              selectedEvent?.entry_type === "doubles"
                ? `
                    <div class="registration-field span-2">
                      <label for="partner_name">Player 2 / Partner Name</label>
                      <input
                        id="partner_name"
                        name="partner_name"
                        type="text"
                        placeholder="Enter second player's name"
                        value="${escapeHtml(state.form.partner_name)}"
                        required
                      />
                    </div>
                  `
                : ""
            }

            ${
              state.form.payment_method === "upi" ||
              state.form.payment_method === "bank_transfer"
                ? `
                    <div class="registration-field span-2">
                      <label for="payment_proof">Payment Proof</label>
                      <input id="payment_proof" name="payment_proof" type="file" accept="image/*,.pdf" />
                    </div>
                  `
                : ""
            }

            <div class="registration-field span-2">
              <label for="notes">Notes</label>
              <textarea id="notes" name="notes" placeholder="Optional notes for tournament desk">${escapeHtml(
                state.form.notes
              )}</textarea>
            </div>
          </div>

          ${
            state.paymentProofName || state.form.payment_proof_url
              ? `
                  <div class="proof-preview" style="margin-top:18px;">
                    ${
                      state.form.payment_proof_url.startsWith("data:image/")
                        ? `<img src="${escapeHtml(state.form.payment_proof_url)}" alt="Payment proof preview" />`
                        : ""
                    }
                    <div>
                      <p><strong>Attached proof:</strong> ${escapeHtml(
                        state.paymentProofName || "Uploaded proof"
                      )}</p>
                      <p class="registration-note">This will be stored with the registration for staff review.</p>
                    </div>
                  </div>
                `
              : ""
          }

          <div style="margin-top:22px;">
            ${renderSelectedEventSummary()}
          </div>

          <div class="registration-toolbar" style="margin-top:24px;">
            <span class="registration-note">
              Submit one event at a time. If the same player is already registered for this event,
              the form will stop with an already-registered message.
            </span>
            <button class="registration-btn primary" type="submit" ${
              state.submitting || state.paymentProcessing ? "disabled" : ""
            }>
              ${
                state.paymentProcessingStep === "verifying"
                  ? "Verifying Payment..."
                  : state.paymentProcessing
                  ? "Opening Razorpay..."
                  : state.submitting
                    ? "Submitting..."
                    : state.form.payment_method === "online"
                      ? "Submit & Pay Online"
                      : "Submit Registration"
              }
            </button>
          </div>
        </form>
      </section>

      ${renderSuccessCard()}

      <section class="registration-help-grid">
        <article class="registration-help-card">
          <p class="registration-kicker">Step 1</p>
          <h3>Select the live event</h3>
          <p>Only categories opened by the tournament admin are shown here, with the latest fee and GST rule.</p>
        </article>
        <article class="registration-help-card">
          <p class="registration-kicker">Step 2</p>
          <h3>Fill the player details</h3>
          <p>Use the actual tournament player details and add the second player name when the selected event is doubles.</p>
        </article>
        ${renderPaymentHelp()}
      </section>
    </section>
  `;
}

function renderLoading() {
  getApp().innerHTML = `
    <section class="registration-shell">
      <section class="registration-panel">
        <p class="registration-kicker">Tournament Registration</p>
        <h1 class="registration-section-title">Loading registration page...</h1>
      </section>
    </section>
  `;
}

function renderError() {
  getApp().innerHTML = `
    <section class="registration-shell">
      <section class="registration-panel">
        <p class="registration-kicker">Tournament Registration</p>
        <h1 class="registration-section-title">Unable to open registration</h1>
        <p class="registration-note">${escapeHtml(state.error || "Something went wrong.")}</p>
        <div class="registration-hero-actions" style="margin-top:18px;">
          <a class="registration-btn secondary" href="${TOURNAMENT_HUB_URL}">Back to Tournament Hub</a>
        </div>
      </section>
    </section>
  `;
}

function bindEvents() {
  const form = document.getElementById("registrationForm");
  if (!form) {
    return;
  }

  form.addEventListener("input", (event) => {
    const target = event.target;

      if (target.matches("input[name], textarea[name], select[name]")) {
        if (target.name === "event_id") {
          state.selectedEventId = target.value;
          const selectedEvent = getSelectedEvent();
          state.form.gender = getGenderLabelFromEvent(selectedEvent);
          if (getSelectedEvent()?.entry_type !== "doubles") {
            state.form.partner_name = "";
          }
          render();
          return;
      }

      setField(target.name, target.value);
    }
  });

  form.addEventListener("change", (event) => {
    const target = event.target;

    if (target.id === "payment_proof") {
      const file = target.files?.[0];

      if (!file) {
        state.form.payment_proof_url = "";
        state.paymentProofName = "";
        render();
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        state.form.payment_proof_url = String(reader.result || "");
        state.paymentProofName = file.name;
        render();
      };
      reader.readAsDataURL(file);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.selectedEventId) {
      state.error = "Please choose an event.";
      state.success = null;
      render();
      return;
    }

    if (getSelectedEvent()?.entry_type === "doubles" && !hasText(state.form.partner_name)) {
      state.error = "Please enter the second player / partner name for doubles.";
      state.success = null;
      render();
      return;
    }

    if (
      (state.form.payment_method === "upi" ||
        state.form.payment_method === "bank_transfer") &&
      !hasText(state.form.payment_proof_url)
    ) {
      state.error = "Please upload payment proof for manual UPI or bank transfer.";
      state.success = null;
      render();
      return;
    }

    state.submitting = true;
    state.paymentProcessing = false;
    state.paymentProcessingStep = "";
    state.error = "";
    state.success = null;
    render();

    try {
      const payload = {
        ...state.form,
        event_id: state.selectedEventId,
        age: Number(state.form.age)
      };

      const response = await publicTournamentApi.submitRegistration(
        state.tournamentLookup,
        payload
      );

      if (state.form.payment_method === "online") {
        state.paymentProcessing = true;
        state.paymentProcessingStep = "opening";
        render();

        const order = await publicTournamentApi.createRegistrationPaymentOrder(
          state.tournamentLookup,
          response.registration.id
        );

        if (order.zero_amount) {
          state.success = {
            ...response,
            message: "Registration submitted successfully. No payment was required."
          };
        } else {
          await openRazorpayCheckout(response, order);
        }
      } else {
        state.success = response;
      }

      state.selectedEventId = "";
      state.form = {
        player_name: "",
        age: "",
        gender: "Boys",
        email: "",
        phone_number: "",
        parent_name: "",
        partner_name: "",
        payment_method: "online",
        notes: "",
        payment_proof_url: ""
      };
      state.paymentProofName = "";
    } catch (error) {
      state.error = error.message || "Unable to submit registration.";
    } finally {
      state.submitting = false;
      state.paymentProcessing = false;
      state.paymentProcessingStep = "";
      render();
    }
  });
}

async function openRazorpayCheckout(registrationResponse, order) {
  const tournament = getTournament();

  if (!window.Razorpay) {
    throw new Error("Razorpay checkout failed to load. Please refresh and try again.");
  }

  await new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: tournament?.tournament_name || "AlphaGrips Tournament",
      description: registrationResponse.registration?.event?.event_name || "Tournament registration",
      order_id: order.order_id,
      prefill: {
        name: registrationResponse.registration?.player_name || state.form.player_name,
        contact: state.form.phone_number || ""
      },
      theme: {
        color: "#1f2d6b"
      },
      handler: async (paymentResponse) => {
        try {
          state.paymentProcessing = true;
          state.paymentProcessingStep = "verifying";
          state.error = "";
          render();

          const verification = await publicTournamentApi.verifyRegistrationPayment(
            state.tournamentLookup,
            registrationResponse.registration.id,
            paymentResponse
          );

          state.success = {
            ...registrationResponse,
            registration: verification.registration,
            message: "Registration submitted and payment completed successfully."
          };
          resolve();
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Payment was cancelled before completion."))
      }
    });

    checkout.open();
  });
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error && !state.overview) {
    renderError();
    return;
  }

  getApp().innerHTML = renderForm();
  bindEvents();
}

async function init() {
  if (!hasText(state.tournamentLookup)) {
    window.location.replace(TOURNAMENT_HUB_URL);
    return;
  }

  renderLoading();

  try {
    const [overview, options] = await Promise.all([
      publicTournamentApi.getOverview(state.tournamentLookup),
      publicTournamentApi.getRegistrationOptions(state.tournamentLookup)
    ]);

    state.overview = overview;
    state.options = options?.events || [];
    state.error = "";
  } catch (error) {
    state.error = error.message || "Unable to open registration page.";
  } finally {
    state.loading = false;
    render();
  }
}

init();
