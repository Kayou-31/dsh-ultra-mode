window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-ultra-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-ultra-mode — client 滑块。
		*
		* composer 输入行右侧的 ULTRA 滑块：关 / 2 / 3 / 4 / 5 路并发。
		* 视觉同款"推理强度"滑块：渐变轨道 + canvas 辐射波 + 呼吸辉光，
		* ultra_task 执行期间进入"燃烧态"（金橙光带 + 白热 knob）。
		*
		* 兼容性与正确性：
		* - `slots` 缺失则不挂载；`connection` 缺失则不渲染（降级为无 UI，
		*   host 工具/命令仍可用）。
		* - 状态按会话隔离：只使用 props.sessionId；缺失时滑块进入禁用态，
		*   绝不回落到共享 bucket。
		* - 能力降级：canvas / ResizeObserver / MutationObserver / matchMedia
		*   缺失时退化为纯 CSS，不抛错。
		* - 4/5 路档位首次使用弹一次成本确认（可记住，见 `ack` 开关）。
		* - 燃烧态只表示"有 ULTRA 正在执行"，不是实际额度计量。
		*/
		const RPC_CHANNEL = "/dsh-ultra-mode";
		const LEVELS = [
			0,
			2,
			3,
			4,
			5
		];
		const RISK_ACK_KEY = "dsh-ultra-mode.risk-ack";
		const indexOf = (s) => s.enabled ? Math.max(1, Math.min(4, (s.concurrency || 3) - 1)) : 0;
		const ULTRA_CSS = [
			".ult-shell{position:relative;display:flex;align-items:center;width:132px;height:32px;color:var(--dsw-alias-label-secondary,#686c75);user-select:none;box-sizing:border-box}",
			".ult-slider{--ult-progress:50%;position:relative;width:100%;height:30px;border-radius:999px;isolation:isolate;transition:filter 180ms ease}",
			".ult-track{position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:linear-gradient(100deg,#03040a 0%,#071126 22%,#101d4c 45%,#302262 70%,#5d35a0 100%);box-shadow:inset 0 1px 0 rgba(189,199,255,.15),inset 0 -1px 0 rgba(0,0,0,.55),0 3px 10px rgba(12,17,55,.34)}",
			".ult-track::after{content:\"\";position:absolute;inset:0;background:radial-gradient(circle at 18% 45%,rgba(82,130,255,.12),transparent 24%),linear-gradient(90deg,rgba(0,0,0,.28),transparent 42%,rgba(168,113,255,.12));pointer-events:none}",
			".ult-fx{position:absolute;z-index:1;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}",
			".ult-canvas{position:absolute;z-index:2;inset:0;width:100%;height:100%;opacity:1;image-rendering:pixelated;mix-blend-mode:screen;transition:filter 140ms ease}",
			".ult-flare{position:absolute;z-index:3;top:50%;left:var(--ult-progress);width:78px;height:46px;border-radius:50%;background:radial-gradient(ellipse at 100% 50%,rgba(255,255,255,.96) 0 4%,rgba(188,189,255,.8) 11%,rgba(106,87,255,.5) 28%,rgba(85,31,255,.2) 49%,transparent 74%);filter:blur(2px) saturate(1.25);mix-blend-mode:screen;transform:translate(-100%,-50%);transition:left 70ms linear,filter 140ms ease;pointer-events:none}",
			".ult-flare::before,.ult-flare::after{content:\"\";position:absolute;inset:50% auto auto 100%;border-radius:999px;transform:translate(-50%,-50%)}",
			".ult-flare::before{width:52px;height:1px;background:linear-gradient(90deg,transparent,rgba(100,160,255,.42),#f1ecff,rgba(193,82,255,.65),transparent);box-shadow:0 0 7px #9b7cff,0 0 13px rgba(72,132,255,.64)}",
			".ult-flare::after{width:1px;height:20px;background:linear-gradient(180deg,transparent,rgba(196,190,255,.84),transparent);box-shadow:0 0 7px #9c7cff}",
			".ult-knob{position:absolute;z-index:4;top:50%;left:clamp(14px,var(--ult-progress),calc(100% - 14px));width:28px;height:28px;border:1px solid rgba(255,255,255,.94);border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(92,105,255,.12),0 0 14px rgba(121,82,255,.48),0 2px 7px rgba(0,0,0,.3);transform:translate(-50%,-50%);transition:left 190ms cubic-bezier(.22,1,.36,1),transform 160ms ease,box-shadow 180ms ease;pointer-events:none}",
			".ult-input{position:absolute;z-index:5;inset:-5px 0;width:100%;height:calc(100% + 10px);margin:0;opacity:0;cursor:grab;touch-action:none}",
			".ult-input:active{cursor:grabbing}",
			".ult-input:focus-visible + .ult-knob{outline:2px solid var(--dsw-static-blue-400,#5d83ff);outline-offset:2px}",
			".ult-shell.is-dragging .ult-canvas{filter:saturate(1.45) brightness(1.28) contrast(1.06)}",
			".ult-shell.is-dragging .ult-flare{filter:blur(1.5px) saturate(1.6) brightness(1.42);transition:none}",
			".ult-shell.is-dragging .ult-knob{transform:translate(-50%,-50%) scale(1.07);transition:none;box-shadow:0 0 0 3px rgba(113,115,255,.25),0 0 20px rgba(74,145,255,.86),0 0 31px rgba(171,53,255,.66),0 3px 8px rgba(0,0,0,.32)}",
			".ult-slider[data-top] .ult-track{animation:ult-dark-breathe 1.9s ease-in-out infinite}",
			".ult-slider[data-top] .ult-knob{box-shadow:0 0 0 3px rgba(119,99,255,.18),0 0 22px rgba(135,78,255,.76),0 0 34px rgba(53,121,255,.34),0 3px 8px rgba(0,0,0,.3)}",
			".ult-shell.is-busy{opacity:.72}",
			".ult-shell.is-disabled{opacity:.4;pointer-events:none}",
			".ult-shell.is-burning .ult-track::before{content:\"\";position:absolute;z-index:0;inset:0;border-radius:inherit;background:linear-gradient(90deg,transparent 0%,rgba(255,140,60,.14) 30%,rgba(255,196,96,.34) 50%,rgba(255,140,60,.14) 70%,transparent 100%);background-size:240% 100%;animation:ult-burn-flow 1.05s linear infinite;mix-blend-mode:screen;pointer-events:none}",
			".ult-shell.is-burning .ult-knob{background:linear-gradient(120deg,#fff 0%,#ffeecb 34%,#ffdc9e 68%,#ffbe62 100%);box-shadow:0 0 0 3px rgba(255,168,60,.24),0 0 26px rgba(255,152,48,.9),0 0 46px rgba(255,84,24,.48),0 0 8px rgba(255,220,150,.8),0 3px 10px rgba(0,0,0,.34)}",
			".ult-shell.is-burning .ult-canvas{filter:saturate(1.9) brightness(1.34) contrast(1.1) hue-rotate(-10deg)}",
			".ult-shell.is-burning .ult-flare{filter:blur(2px) saturate(1.9) brightness(1.46)}",
			"@keyframes ult-burn-flow{0%{background-position:130% 0}100%{background-position:-130% 0}}",
			".ult-confirm{position:absolute;right:0;bottom:calc(100% + 10px);z-index:40;width:264px;padding:10px 12px;border:1px solid var(--dsw-alias-stroke-secondary,rgba(121,126,145,.28));border-radius:12px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:0 12px 32px rgba(18,24,42,.22);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#15171b)}",
			"body[data-ds-dark-theme] .ult-confirm{background:var(--dsw-alias-bg-elevated,#202126);color:var(--dsw-alias-label-primary,#f2f4f8);box-shadow:0 14px 36px rgba(0,0,0,.5)}",
			".ult-confirm-actions{display:flex;gap:8px;margin-top:9px}",
			".ult-confirm-ok,.ult-confirm-cancel{padding:4px 10px;border:0;border-radius:8px;font-size:12px;cursor:pointer}",
			".ult-confirm-ok{color:#fff;background:var(--dsw-static-deepseek-500,#4d70ff)}",
			".ult-confirm-cancel{color:var(--dsw-alias-label-secondary,#686c75);background:var(--dsw-alias-fill-tertiary,rgba(120,125,140,.12))}",
			"body:not([data-ds-dark-theme]) .ult-slider{filter:none}",
			"body:not([data-ds-dark-theme]) .ult-track{background:var(--dsw-static-blue-75,#e5f0ff);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px rgba(80,133,194,.14),0 3px 10px rgba(48,101,165,.13)}",
			"body:not([data-ds-dark-theme]) .ult-track::before{content:\"\";position:absolute;z-index:0;inset:0 auto 0 0;width:var(--ult-progress);border-radius:inherit;background:linear-gradient(90deg,#fff 0%,#e2f0ff 20%,#a8d0fb 57%,#438fdf 100%);transition:width 190ms cubic-bezier(.22,1,.36,1)}",
			"body:not([data-ds-dark-theme]) .ult-slider[data-top] .ult-track::before{background:linear-gradient(90deg,#fff 0%,#d7eaff 18%,#75afea 54%,#0751ad 100%)}",
			"body:not([data-ds-dark-theme]) .ult-shell.is-dragging .ult-track::before{transition:none}",
			"body:not([data-ds-dark-theme]) .ult-track::after{z-index:1;background:linear-gradient(90deg,rgba(255,255,255,.48),transparent 34%,rgba(23,101,201,.07))}",
			"body:not([data-ds-dark-theme]) .ult-canvas{opacity:.78;mix-blend-mode:multiply}",
			"body:not([data-ds-dark-theme]) .ult-flare{background:radial-gradient(ellipse at 100% 50%,rgba(255,255,255,.98) 0 5%,rgba(204,231,255,.88) 13%,rgba(91,162,241,.48) 31%,rgba(37,111,207,.16) 53%,transparent 75%);filter:blur(2px) saturate(1.12)}",
			"body:not([data-ds-dark-theme]) .ult-flare::before{background:linear-gradient(90deg,transparent,rgba(116,177,244,.34),#fff,rgba(66,139,225,.58),transparent);box-shadow:0 0 7px rgba(58,133,222,.5),0 0 13px rgba(104,176,255,.38)}",
			"body:not([data-ds-dark-theme]) .ult-flare::after{background:linear-gradient(180deg,transparent,rgba(255,255,255,.94),transparent);box-shadow:0 0 7px rgba(64,137,224,.44)}",
			"body:not([data-ds-dark-theme]) .ult-knob{border-color:rgba(126,160,197,.32);box-shadow:0 0 0 2px rgba(58,124,207,.09),0 0 13px rgba(48,118,207,.3),0 3px 8px rgba(39,77,119,.18)}",
			"body:not([data-ds-dark-theme]) .ult-slider[data-top] .ult-track{animation-name:ult-light-breathe}",
			"body:not([data-ds-dark-theme]) .ult-slider[data-top] .ult-knob,body:not([data-ds-dark-theme]) .ult-shell.is-dragging .ult-knob{box-shadow:0 0 0 3px rgba(36,105,192,.15),0 0 20px rgba(25,100,201,.45),0 3px 8px rgba(39,77,119,.18)}",
			"body:not([data-ds-dark-theme]) .ult-shell.is-burning .ult-track::before{background:linear-gradient(90deg,transparent 0%,rgba(255,190,90,.28) 30%,rgba(255,214,130,.6) 50%,rgba(255,190,90,.28) 70%,transparent 100%);background-size:240% 100%;animation:ult-burn-flow 1.05s linear infinite;mix-blend-mode:normal}",
			"body:not([data-ds-dark-theme]) .ult-shell.is-burning .ult-knob{background:linear-gradient(120deg,#fff 0%,#fff3d8 34%,#ffe6ae 68%,#ffca70 100%);box-shadow:0 0 0 3px rgba(255,170,64,.28),0 0 24px rgba(255,150,40,.72),0 3px 10px rgba(90,50,10,.24)}",
			"body:not([data-ds-dark-theme]) .ult-shell.is-burning .ult-canvas{filter:saturate(1.7) brightness(1.2) contrast(1.08) hue-rotate(-8deg)}",
			"@keyframes ult-dark-breathe{0%,100%{box-shadow:inset 0 1px 0 rgba(196,204,255,.16),0 3px 10px rgba(18,25,72,.4)}50%{box-shadow:inset 0 1px 0 rgba(220,214,255,.24),0 0 21px rgba(111,66,255,.5)}}",
			"@keyframes ult-light-breathe{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px rgba(67,124,193,.16),0 3px 10px rgba(48,101,165,.13)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.96),inset 0 0 0 1px rgba(31,102,190,.22),0 0 19px rgba(31,105,201,.24)}}",
			"@media (prefers-reduced-motion:reduce){.ult-slider[data-top] .ult-track{animation:none}.ult-knob,.ult-flare,body:not([data-ds-dark-theme]) .ult-track::before{transition:none}.ult-shell.is-burning .ult-track::before{animation:none}}"
		].join("");
		/** 画布辐射波：能力缺失时由调用方降级（不绘制也不报错）。 */
		function drawRadiation(context, width, height, time, progress, dragging, burning) {
			const origin = progress * width;
			const isDark = document.body !== null && document.body.hasAttribute("data-ds-dark-theme");
			const cell = 4;
			const speed = dragging ? 2.8 : burning ? 2.4 : 1;
			context.clearRect(0, 0, width, height);
			if (origin <= 1) return;
			context.save();
			context.beginPath();
			context.rect(0, 0, origin, height);
			context.clip();
			for (let x = 0; x < origin; x += cell) {
				const delta = x + cell * .5 - origin;
				const distance = Math.abs(delta);
				const phaseA = distance / 10 - time * .0074 * speed;
				const phaseB = distance / 23 - time * .0041 * speed + 1.7;
				const phaseC = distance / 40 - time * .0022 * speed + 3.4;
				const sinA = Math.max(0, Math.sin(phaseA));
				const sinB = Math.max(0, Math.sin(phaseB));
				const sinC = Math.max(0, Math.sin(phaseC));
				const waveA = Math.pow(sinA, 2.6);
				const waveB = Math.pow(sinB, 3.2);
				const waveC = Math.pow(sinC, 4);
				const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * .78;
				const wave = Math.min(1, waveA * .76 + waveB * .58 + waveC * .32);
				const trail = .38 + .62 * Math.exp(-distance / Math.max(55, width * .72));
				const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * .0016)), 3) * .27;
				const columnEnergy = trail * (wave * 1.04 + pillar + crest * .32);
				if (columnEnergy > .012) {
					const nearness = Math.max(0, 1 - distance / Math.max(1, width * .78));
					context.fillStyle = `rgba(${isDark ? Math.round(52 + 128 * nearness + 70 * wave) : Math.round(30 + 62 * nearness + 16 * wave)},${isDark ? Math.round(60 + 60 * nearness + 42 * crest) : Math.round(92 + 74 * nearness + 28 * crest)},${isDark ? Math.round(176 + 70 * nearness + 8 * wave) : Math.round(184 + 60 * nearness)},${isDark ? Math.min(.88, columnEnergy * .72) : Math.min(.6, columnEnergy * .52)})`;
					context.fillRect(x, 0, cell - 1, height);
				}
				for (let y = 0; y < height; y += cell) {
					const deltaY = y + cell * .5 - height * .5;
					const radial = Math.hypot(delta / 38, deltaY / 11);
					const halo = Math.exp(-radial * .96) * 1.08;
					const verticalShape = .58 + .42 * Math.cos(deltaY / height * Math.PI);
					const grain = .72 + .28 * Math.sin(x * .73 + y * 1.31 + time * .006);
					const alpha = Math.min(.96, (columnEnergy * .88 + halo + crest * .19) * verticalShape * grain);
					if (alpha < .035) continue;
					const hot = Math.max(0, 1 - radial / 2.4);
					context.fillStyle = `rgba(${isDark ? Math.round(60 + 148 * hot + 40 * wave + 34 * crest) : Math.round(30 + 74 * hot + 12 * wave)},${isDark ? Math.round(72 + 80 * hot + 44 * crest) : Math.round(100 + 72 * hot + 22 * crest)},${isDark ? Math.round(188 + 62 * hot) : Math.round(196 + 54 * hot)},${isDark ? alpha : alpha * .7})`;
					context.fillRect(x, y, cell - 1, cell - 1);
				}
			}
			const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24);
			glow.addColorStop(0, isDark ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.86)");
			glow.addColorStop(.14, isDark ? "rgba(190,192,255,.54)" : "rgba(168,212,255,.48)");
			glow.addColorStop(.44, isDark ? "rgba(108,76,255,.28)" : "rgba(42,116,208,.22)");
			glow.addColorStop(1, isDark ? "rgba(88,32,214,0)" : "rgba(28,94,184,0)");
			context.fillStyle = glow;
			context.fillRect(origin - 26, 0, 52, height);
			context.restore();
		}
		function readRiskAck() {
			try {
				return window.localStorage.getItem(RISK_ACK_KEY) === "true";
			} catch {
				return false;
			}
		}
		function writeRiskAck() {
			try {
				window.localStorage.setItem(RISK_ACK_KEY, "true");
			} catch {}
		}
		function UltraSlider({ sessionId, rpc }) {
			const [state, setState] = react.default.useState({
				enabled: false,
				concurrency: 3,
				running: false,
				activeRuns: 0,
				lastRun: null
			});
			const [preview, setPreview] = react.default.useState(0);
			const [dragging, setDragging] = react.default.useState(false);
			const [busy, setBusy] = react.default.useState(false);
			const [pendingRisk, setPendingRisk] = react.default.useState(null);
			const canvasRef = react.default.useRef(null);
			const inputRef = react.default.useRef(null);
			const committedRef = react.default.useRef(0);
			const previewRef = react.default.useRef(0);
			const draggingRef = react.default.useRef(false);
			const radRef = react.default.useRef({
				progress: 0,
				dragging: false,
				burning: false
			});
			const redrawRef = react.default.useRef(null);
			const enabled = typeof sessionId === "string" && sessionId.trim() !== "";
			react.default.useEffect(() => {
				if (!enabled) return;
				let alive = true;
				const sync = () => {
					rpc.call(RPC_CHANNEL, "get", { sessionId }).then((raw) => {
						if (!alive) return;
						const result = raw;
						if (result === null || result === void 0 || !result.ok) return;
						setState(result.value);
						const idx = indexOf(result.value);
						if (!draggingRef.current && !busy) {
							committedRef.current = idx;
							if (Math.round(previewRef.current) !== idx) {
								previewRef.current = idx;
								setPreview(idx);
							}
						}
					}).catch(() => void 0);
				};
				sync();
				const timer = window.setInterval(sync, 800);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [
				rpc,
				sessionId,
				enabled,
				busy
			]);
			react.default.useEffect(() => {
				radRef.current.burning = state.running === true;
				if (redrawRef.current) redrawRef.current();
			}, [state]);
			react.default.useEffect(() => {
				previewRef.current = preview;
				radRef.current.progress = preview / 4;
				if (redrawRef.current) redrawRef.current();
			}, [preview]);
			react.default.useEffect(() => {
				radRef.current.dragging = dragging;
				if (redrawRef.current) redrawRef.current();
			}, [dragging]);
			react.default.useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return;
				const context = canvas.getContext("2d");
				if (context === null) return;
				let width = 1;
				let height = 1;
				let frame = 0;
				let reducedMotion = false;
				try {
					reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
				} catch {
					reducedMotion = false;
				}
				const resize = () => {
					const bounds = canvas.getBoundingClientRect();
					let ratio = 1;
					try {
						ratio = Math.min(window.devicePixelRatio || 1, 2);
					} catch {
						ratio = 1;
					}
					width = Math.max(1, bounds.width);
					height = Math.max(1, bounds.height);
					canvas.width = Math.max(1, Math.round(width * ratio));
					canvas.height = Math.max(1, Math.round(height * ratio));
					context.setTransform(ratio, 0, 0, ratio, 0, 0);
				};
				const draw = (time = 0) => drawRadiation(context, width, height, time, radRef.current.progress, radRef.current.dragging, radRef.current.burning);
				const loop = (time) => {
					draw(time);
					frame = window.requestAnimationFrame(loop);
				};
				const redraw = () => {
					if (reducedMotion) draw();
				};
				let resizeObserver = null;
				let themeObserver = null;
				try {
					resizeObserver = new ResizeObserver(() => {
						resize();
						draw();
					});
					resizeObserver.observe(canvas);
				} catch {
					resizeObserver = null;
				}
				try {
					themeObserver = new MutationObserver(() => draw());
					themeObserver.observe(document.body, {
						attributes: true,
						attributeFilter: ["data-ds-dark-theme"]
					});
				} catch {
					themeObserver = null;
				}
				redrawRef.current = redraw;
				resize();
				draw();
				if (!reducedMotion) frame = window.requestAnimationFrame(loop);
				return () => {
					window.cancelAnimationFrame(frame);
					if (resizeObserver !== null) resizeObserver.disconnect();
					if (themeObserver !== null) themeObserver.disconnect();
					redrawRef.current = null;
				};
			}, []);
			const rollback = () => {
				const previous = committedRef.current;
				previewRef.current = previous;
				setPreview(previous);
			};
			const commit = async (raw) => {
				if (busy || !enabled) return;
				const idx = Math.max(0, Math.min(4, Math.round(raw)));
				if (idx >= 3 && !readRiskAck()) {
					setPendingRisk(idx);
					return;
				}
				setBusy(true);
				previewRef.current = idx;
				setPreview(idx);
				const next = idx === 0 ? {
					enabled: false,
					concurrency: state.concurrency || 3
				} : {
					enabled: true,
					concurrency: LEVELS[idx]
				};
				try {
					const saved = await rpc.call(RPC_CHANNEL, "set", {
						sessionId,
						...next
					});
					if (saved === void 0 || saved.ok !== true) {
						rollback();
						return;
					}
					setState(saved.value);
					committedRef.current = idx;
				} catch {
					rollback();
				} finally {
					setBusy(false);
				}
			};
			const confirmRisk = (accepted) => {
				const idx = pendingRisk;
				setPendingRisk(null);
				if (!accepted || idx === null) {
					rollback();
					return;
				}
				writeRiskAck();
				commit(idx);
			};
			const rawFromPointer = (input, clientX) => {
				const bounds = input.getBoundingClientRect();
				if (bounds.width <= 0) return previewRef.current;
				return Math.max(0, Math.min(4, (clientX - bounds.left) / bounds.width * 4));
			};
			const onPointerDown = (event) => {
				const input = event.currentTarget;
				event.preventDefault();
				input.focus();
				draggingRef.current = true;
				setDragging(true);
				const raw = rawFromPointer(input, event.clientX);
				previewRef.current = raw;
				setPreview(raw);
				try {
					if (!input.hasPointerCapture(event.pointerId)) input.setPointerCapture(event.pointerId);
				} catch {}
			};
			const onPointerMove = (event) => {
				if (!draggingRef.current) return;
				const input = event.currentTarget;
				const raw = rawFromPointer(input, event.clientX);
				previewRef.current = raw;
				setPreview(raw);
			};
			const onPointerUp = (event) => {
				if (!draggingRef.current) return;
				draggingRef.current = false;
				setDragging(false);
				const input = event.currentTarget;
				try {
					if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
				} catch {}
				const raw = rawFromPointer(input, event.clientX);
				previewRef.current = raw;
				setPreview(raw);
				commit(raw);
			};
			const onKeyDown = (event) => {
				const current = Math.round(previewRef.current);
				let target;
				if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "PageDown") target = Math.max(0, current - 1);
				else if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp") target = Math.min(4, current + 1);
				else if (event.key === "Home") target = 0;
				else if (event.key === "End") target = 4;
				if (target === void 0) return;
				event.preventDefault();
				previewRef.current = target;
				setPreview(target);
				commit(target);
			};
			const idx = Math.round(preview);
			const label = idx === 0 ? "ULTRA 关" : `ULTRA ${LEVELS[idx]}路`;
			const burning = state.running === true;
			const className = [
				"ult-shell",
				dragging ? "is-dragging" : "",
				busy ? "is-busy" : "",
				burning ? "is-burning" : "",
				enabled ? "" : "is-disabled"
			].filter((part) => part !== "").join(" ");
			return react.default.createElement("div", {
				className,
				title: enabled ? "ULTRA 并发模式：拖到最左=关，2/3/4/5 路并发；执行中滑块进入运行态光效（不代表实际额度计量）\n（也可 /ultra on|off|<2-5>）" : "ULTRA 滑块不可用：当前会话缺少 sessionId"
			}, pendingRisk === null ? null : react.default.createElement("div", {
				className: "ult-confirm",
				role: "dialog",
				"aria-label": "ULTRA 成本确认"
			}, react.default.createElement("div", null, `${LEVELS[pendingRisk]} 路 ULTRA 每条请求最多额外启动 ${LEVELS[pendingRisk] + 1} 个 agent；实际消耗取决于各分支输出与合并输入，部分失败或取消也可能已经产生消耗。确认开启？`), react.default.createElement("div", { className: "ult-confirm-actions" }, react.default.createElement("button", {
				type: "button",
				className: "ult-confirm-ok",
				onClick: () => confirmRisk(true)
			}, "确认开启"), react.default.createElement("button", {
				type: "button",
				className: "ult-confirm-cancel",
				onClick: () => confirmRisk(false)
			}, "取消"))), react.default.createElement("div", {
				className: "ult-slider",
				"data-top": idx === 4 ? "true" : void 0,
				style: { "--ult-progress": `${idx / 4 * 100}%` }
			}, react.default.createElement("span", {
				className: "ult-track",
				"aria-hidden": true
			}), react.default.createElement("span", {
				className: "ult-fx",
				"aria-hidden": true
			}, react.default.createElement("canvas", {
				ref: canvasRef,
				className: "ult-canvas"
			}), react.default.createElement("span", { className: "ult-flare" })), react.default.createElement("input", {
				ref: inputRef,
				className: "ult-input",
				type: "range",
				min: "0",
				max: "4",
				step: "1",
				value: idx,
				disabled: busy || !enabled,
				"aria-label": "ULTRA 并发模式",
				"aria-valuetext": label,
				onChange: (event) => {
					const raw = Number(event.currentTarget.value);
					previewRef.current = raw;
					setPreview(raw);
				},
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onKeyDown,
				onBlur: () => {
					if (draggingRef.current) {
						draggingRef.current = false;
						setDragging(false);
					}
				}
			}), react.default.createElement("span", {
				className: "ult-knob",
				"aria-hidden": true
			})));
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-ultra-mode";
				style.textContent = ULTRA_CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-ultra-mode: styles");
			const rpc = ctx.get("connection")?.rpc;
			if (rpc === void 0) return;
			ctx.effect(() => ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "ultra-mode",
				order: 30,
				label: "ULTRA"
			}, (props) => react.default.createElement(UltraSlider, {
				sessionId: props.sessionId,
				rpc
			}))), "dsh-ultra-mode: slider");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map