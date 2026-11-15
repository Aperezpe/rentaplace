// Hunts: one card per finished hunt of the error hunter, by request number: what fails, what still
// works, what the hunter asked that is in neither list. Everything shown comes from hunts.mjs, which
// reads the hunter host's store read-only. No model is called here. Enter sends the selected report
// to Main.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, focused, exec, appHome, run, theme, nextCommand, shared, setShared, openOverlay, closeOverlay, props, layout } from "herdr";
import { step, widgetDirection, COLLAPSE_KEY, loadCollapsed, applyCollapse, returnTarget, tip, keepInView, wheelTop, maxTop, fitCount, estimateViewport } from "./nav.js";
import { createFrame, frameParts } from "./frame.js";

const NAME = "hunts";
const TITLE = "Hunts";
const helper = () => `${appHome()}/mods/${NAME}/hunts.mjs`;
const callHelper = (argv, timeout = 15_000) => exec("node", ["--disable-warning=ExperimentalWarning", helper(), ...argv], { timeout });
function helperError(r) {
  const text = String(r.stderr ?? "").trim();
  try {
    return JSON.parse(text.split("\n").pop()).error.message;
  } catch {
    return text.slice(0, 200) || `exit ${r.code}`;
  }
}
const sessionName = (title) => String(title ?? "").replace(/^π\s*-\s*/, "").replace(/\s+-\s+[^-]+$/, "").trim();
// Main in the shown space: the Pi session named Main, else the first Pi tab (as Issues does).
function mainIn(space) {
  const pis = agents().filter((a) => a.space === space && a.app === "pi");
  const main = pis.find((a) => /^main$/i.test(sessionName(a.title))) ?? pis.slice().sort((x, y) => x.tab_index - y.tab_index)[0] ?? null;
  return main?.address ?? null;
}
const windowHeight = () => {
  try {
    return /** @type {any} */ (globalThis).window?.viewport_size?.().height ?? 900;
  } catch {
    return 900;
  }
};
const numbers = (list) => (list.length ? list.map((c) => c.n).join(" ") : "none");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Fixed row heights (the list is windowed by hand): padding 18 + head 18 + replay 16 + rule 57 + three lists 51 + notes 16 + gaps 24 + border 2.
const ROW = { reported: 203, hunting: 62, unreadable: 62 };

function legend(t, keys) {
  return h_flex()
    .flex_none()
    .px(12)
    .py(5)
    .gap_x(8)
    .gap_y(3)
    .flex_wrap()
    .border_t(1)
    .border_color(t.border)
    .children(
      keys.map(([k, label]) =>
        h_flex()
          .id(`legend-${label}`)
          .gap(4)
          .items_center()
          .tooltip(tip({ Next: "Next widget", Back: "Back to Main", Select: "Select a hunt" }[label] ?? label, k))
          .child(div().px(4).rounded(3).border(1).border_color(t.border).text_size(10).text_color(t.foreground).child(k))
          .child(div().text_size(10.5).text_color(t.dim).child(label)),
      ),
    );
}

export default class Hunts extends View {
  init(_props, cx) {
    this.doc = null; // the last `show` document
    this.error = null;
    this.busy = false;
    this.notice = null;
    this.sel = null; // the selected hunt's id
    this.top = 0;
    this.viewH = null;
    this.lastHeights = null;
    this.lastVp = 0;
    this.before = null;
    this.project = null;
    this.roots = {}; // cwd -> git root
    this.space = null;
    this.every = 10_000;
    this.last = 0;
    this.collapsed = loadCollapsed(localStorage, NAME);
    this.handle = cx.focus_handle();
    this.frame = createFrame({ mod: NAME, h: { layout, run, shared, setShared, openOverlay, closeOverlay, props } });
    const carried = this.frame.start();
    if (carried) {
      this.sel = carried.sel ?? null;
      this.top = carried.top ?? 0;
      if (typeof carried.collapsed === "boolean") this.collapsed = carried.collapsed;
    }
    if (this.frame.floating) this.handle.focus();
    this.tick(cx);
    cx.timer.every(2000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") this.refresh(cx);
        else if (c === "focus") this.takeKeyboard();
        else this.command(c, cx);
        cx.notify();
      }
    });
  }

  tick(cx) {
    this.frame.check();
    if (!this.frame.active()) return; // hidden, closed or popped out elsewhere: no reading
    // The project is the git root of the focused terminal's folder (as Issues does); it stays while
    // the keyboard is in the widget.
    const f = focused();
    const cwd = f?.cwd;
    if (f?.space) this.space = f.space;
    if (cwd) {
      if (this.roots[cwd] === undefined) {
        this.roots[cwd] = null;
        cx.spawn(async (cx) => {
          const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], /** @type {any} */ ({ timeout: 5000 }));
          this.roots[cwd] = r.code === 0 ? r.stdout.trim() : cwd;
          this.tick(cx);
          cx.notify();
        });
        return;
      }
      const project = this.roots[cwd];
      if (project && project !== this.project) {
        this.project = project;
        this.doc = null;
        this.last = 0;
      }
    }
    if (Date.now() - this.last >= this.every) this.refresh(cx);
  }

  refresh(cx) {
    if (!this.frame.active() || this.busy) return;
    if (!this.project) return ((this.doc = null), (this.error = null), cx.notify());
    this.busy = true;
    this.last = Date.now();
    const project = this.project;
    cx.spawn(async (cx) => {
      const r = await callHelper(["show", "--root", project]);
      this.busy = false;
      if (project !== this.project) return;
      if (r.code !== 0) this.error = helperError(r);
      else {
        try {
          this.doc = JSON.parse(r.stdout);
          this.error = null;
          this.every = Math.max(2, Number(this.doc.settings?.refreshSeconds) || 10) * 1000;
        } catch {
          this.error = "The card's helper did not answer with JSON";
        }
      }
      cx.notify();
    });
  }

  viewState() {
    return { sel: this.sel, top: this.top, collapsed: this.collapsed };
  }

  close() {
    this.frame.closed();
  }

  takeKeyboard() {
    const f = focused();
    if (f && (f.pane || f.terminal)) this.before = { pane: f.pane, terminal: f.terminal };
    this.handle.focus();
  }

  setCollapsed(on) {
    this.collapsed = on;
    if (this.frame.floating) return;
    applyCollapse({ mod: NAME, collapsed: on, storage: localStorage, layout, run });
  }

  send(cx) {
    if (!this.frame.active()) return;
    const h = (this.doc?.hunts ?? []).find((x) => x.id === this.sel);
    const why = this.sendBlocked(h);
    if (why) return ((this.notice = why), cx.notify());
    const terminal = mainIn(this.space);
    this.notice = "Sending to Main…";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await callHelper(["act", h.id, "send-main", "--root", this.project, "--terminal", terminal], 30_000);
      this.notice = r.code === 0 ? `Sent hunt ${h.short} to Main` : helperError(r);
      cx.notify();
    });
  }

  /** Why Enter cannot send right now, or null. */
  sendBlocked(h) {
    if (!h) return "No hunt selected";
    if (h.state !== "reported") return "This hunt has not filed its report yet";
    if (!mainIn(this.space)) return "No Main conversation in this space";
    return null;
  }

  command(k, cx) {
    if (k === "escape" && this.frame.dragging() === "mine") return (this.frame.dragCancel(), true);
    if (this.frame.command(k, this.viewState())) return true;
    if (k === "escape") {
      const t = returnTarget(this.before, null);
      this.before = null;
      if (t) run("pane.focus", t);
      return true;
    }
    if (k === COLLAPSE_KEY || k === "collapse") return (this.setCollapsed(!this.collapsed), true);
    if (k === "r") return (this.refresh(cx), true);
    const dir = widgetDirection(k);
    if (dir) return (run("pane.go", { direction: dir }), true);
    if (this.collapsed) return false;
    if (k === "enter" || k === "send-main") return (this.send(cx), true);
    const list = (this.doc?.hunts ?? []).map((h) => h.id);
    const at = Math.max(0, list.indexOf(this.sel));
    const next = step(at, list.length, k);
    if (next != null) {
      this.sel = list[next];
      this.notice = null;
      if (this.lastHeights) this.top = keepInView(this.top, next, this.lastHeights, this.lastVp);
      return true;
    }
    return false;
  }

  line(t, color, label, list, hint) {
    const text = numbers(list);
    return h_flex()
      .id(`line-${label}-${list[0]?.n ?? 0}`)
      .h(17)
      .gap(6)
      .items_center()
      .tooltip(list.length ? `${hint}\n${list.map((c) => `${c.n}. ${c.method} ${c.path} → ${c.status}`).join("\n")}` : hint)
      .child(div().flex_none().w(84).text_size(11).text_color(color).child(`${label} ${list.length}`))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(text));
  }

  card(t, h, selected) {
    const box = v_flex()
      .id(`hunt-${h.id}`)
      .h(ROW[h.state])
      .overflow_hidden()
      .p(9)
      .gap(4)
      .rounded(7)
      .border(1)
      .border_color(selected ? t.accent : t.border)
      .bg(selected ? t.hover : t.chrome)
      .cursor_pointer()
      .on_click((_e, cx) => {
        this.sel = h.id;
        this.takeKeyboard();
        cx.notify();
      });
    const head = h_flex()
      .h(18)
      .gap(6)
      .items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.foreground).child(`Hunt ${h.short}`))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${h.requests} requests`));
    if (h.state !== "reported")
      return box.child(head).child(div().text_size(11.5).text_color(t.working).child(h.state === "hunting" ? "Hunting… no report filed yet" : "Its report cannot be read"));
    return box
      .child(head)
      .child(div().h(16).truncate().text_size(11).text_color(h.reproduced ? t.done : t.blocked).child(h.reproduced ? "Replayed the logged error: same failure" : "Could not replay the logged error"))
      .child(div().id(`rule-${h.id}`).h(57).overflow_hidden().text_size(11.5).text_color(t.foreground).tooltip(h.rule || "The report has no rule").child(clip(h.rule || "The report has no rule", 125)))
      .child(this.line(t, t.blocked, "Fails", h.fails, "Requests that hit the same failure, by request number"))
      .child(this.line(t, t.done, "Still works", h.works, "Neighbours that work: they mark the edge"))
      .child(this.line(t, t.dim, "Neither", h.neither, "Requests the hunter made and listed in neither: look-ups, sign-ins, refusals the product intends"))
      .child(
        div()
          .id(`notes-${h.id}`)
          .h(16)
          .truncate()
          .text_size(10.5)
          .text_color(h.dropped.length ? t.blocked : t.dim)
          .tooltip(h.dropped.length ? h.dropped.map((d) => `${d.n} in ${d.list}: ${d.why}`).join("\n") : h.notes || "The hunter left no notes. What it did not try is only in its notes.")
          .child(h.dropped.length ? `${h.dropped.length} listed request(s) dropped: not in the store` : h.notes ? `Notes: ${h.notes}` : "No notes"),
      );
  }

  render() {
    const t = theme();
    const doc = this.doc;
    const hunts = doc?.hunts ?? [];
    const hasKeys = this.handle.is_focused();
    if (!hunts.some((h) => h.id === this.sel)) this.sel = hunts[0]?.id ?? null;
    const selected = hunts.find((h) => h.id === this.sel);
    const c = doc?.counts ?? { hunts: 0, reported: 0, hunting: 0 };
    const summary = doc?.unavailable ? "no store" : `${c.reported} reported${c.hunting ? ` · ${c.hunting} hunting` : ""}`;
    const parts = frameParts({ div, h_flex, v_flex }, t, this.frame, tip, () => this.viewState());
    const header = h_flex()
      .id("hunts-header")
      .px(14)
      .h(36)
      .flex_none()
      .gap(8)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(this.frame.floating ? `${TITLE} · drag to move the window` : `${tip(this.collapsed ? `Expand ${TITLE}` : `Collapse ${TITLE}`, "−")} · drag onto another widget to move it`)
      .on_click(() => this.setCollapsed(!this.collapsed))
      .on_mouse_down("left", () => {
        if (!this.handle.is_focused()) this.takeKeyboard();
        this.frame.dragStart();
      })
      .child(div().flex_none().text_size(10).text_color(t.dim).child(this.collapsed ? "▸" : "▾"))
      .child(div().flex_none().text_size(11.5).font_medium().text_color(hasKeys ? t.accent : t.dim).child(TITLE))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`· ${summary}`))
      .child(
        div()
          .id("hunts-refresh")
          .flex_none()
          .px(4)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(this.busy ? "Reading…" : tip("Read the store now", "R"))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.refresh(cx);
          })
          .child(this.busy ? "…" : "↻"),
      )
      .children(parts.buttons);

    const shell = v_flex()
      .id("root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.command(e.keystroke, cx)) cx.notify();
      })
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_l(1)
      .border_color(t.border)
      .when(hasKeys, (el) => el.border_t(2).border_color(t.accent))
      .text_size(13)
      .relative()
      .on_mouse_up("left", () => this.frame.dragCancel())
      .child(header)
      .when(Boolean(parts.note), (el) => el.child(parts.note))
      .when(Boolean(parts.drop), (el) => el.child(parts.drop));
    if (this.collapsed) return shell;

    // Loading, no project, source unavailable, empty and failed each read differently.
    let empty = null;
    let help = null;
    if (!this.project) (empty = "No project in this space"), (help = "Open a terminal in a project that runs the error hunter.");
    else if (this.error && !doc) (empty = "The card could not read the store"), (help = this.error);
    else if (!doc) empty = "Reading the hunter's store…";
    else if (doc.unavailable) (empty = "No hunter store here"), (help = doc.unavailable.message);
    else if (!hunts.length) (empty = "No hunts yet"), (help = "A hunt starts by itself when the product logs a server error. Its report shows here: what fails, what still works, by request number.");

    const heights = hunts.map((h) => ROW[h.state] + 8);
    const vp = this.viewH ?? estimateViewport(layout(), NAME, windowHeight(), 150);
    this.lastHeights = heights;
    this.lastVp = vp;
    this.top = Math.min(this.top ?? 0, maxTop(heights, vp));
    const shown = fitCount(heights, this.top, vp);
    const list = div()
      .id("hunts-list")
      .flex_1()
      .min_h(60)
      .overflow_hidden()
      .relative()
      .on_mouse_move((e) => {
        if (e.bounds?.height) this.viewH = e.bounds.height;
      })
      .on_scroll_wheel((e, cx) => {
        if (e.bounds?.height) this.viewH = e.bounds.height;
        this.top = wheelTop(this.top, e.delta.y, heights, this.viewH ?? vp);
        cx.notify();
      })
      .child(v_flex().children(heights.slice(this.top, this.top + shown + 1).map((hgt, j) => div().h(hgt).flex_none().px(10).pb(8).child(this.card(t, hunts[this.top + j], hunts[this.top + j].id === this.sel)))));
    const blocked = this.sendBlocked(selected);
    const footer = this.notice ?? (this.error && doc ? `Read failed: ${this.error}` : doc?.hidden ? `${doc.hidden} older hunts not shown` : doc ? "Read from the hunter's store · no model" : "");
    return shell
      .when(Boolean(empty), (el) =>
        el.child(
          v_flex()
            .flex_1()
            .px(16)
            .pt(16)
            .gap(6)
            .child(div().text_size(12.5).text_color(t.muted).child(empty))
            .when(Boolean(help), (el) => el.child(div().text_size(12).text_color(t.dim).child(help))),
        ),
      )
      .when(!empty, (el) => el.child(v_flex().flex_1().min_h(76).pt(6).child(list).when(heights.length > shown, (el) => el.child(div().flex_none().h(16).px(14).text_size(10).text_color(t.dim).child(`Showing ${this.top + 1}–${Math.min(heights.length, this.top + shown)} of ${heights.length} · scroll or ↑↓`)))))
      .child(legend(t, [["↑↓", "Select"], ["Enter", blocked ? `Send to Main (${blocked})` : "Send to Main"], ["R", "Read now"], ["Tab", "Next"], ["−", "Collapse"], ...parts.legend, ["Esc", "Back"]]))
      .child(
        v_flex()
          .flex_none()
          .px(14)
          .py(7)
          .gap(2)
          .border_t(1)
          .border_color(t.border)
          .when(Boolean(doc?.settings_problems?.length), (el) => el.child(div().text_size(11).text_color(t.blocked).child(`Settings: ${(doc?.settings_problems ?? []).join(" · ")}`)))
          .child(div().id("hunts-footer").truncate().text_size(11).text_color(t.dim).tooltip(doc?.store ? `Store: ${doc.store}. Change it: node hunts.mjs config set store <path>` : "No store read yet").child(footer)),
      );
  }
}
