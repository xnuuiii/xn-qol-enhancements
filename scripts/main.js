//This is just a "port" that was quickly made. I've tested most of the features and i don't think there are any bugs?
function isJ(b){ return b instanceof LiquidJunction || b instanceof Junction; }
const DEBUG = false;
function dbg(s){ if(DEBUG) Log.info("[xn-qol] " + s); }
dbg("loaded");

let tick = 0;
function log(s){ if(tick++ % 30 == 0) dbg("[phase] " + s); }

function phaseFor(b){
    if(b instanceof Conduit) return Blocks.phaseConduit;
    if(b instanceof Duct || b instanceof Conveyor) return Blocks.phaseConveyor;
    return null;
}

function isBr(b){ return b instanceof ItemBridge || b instanceof DirectionBridge; }
function dirBr(blk){ try{ return blk.rotBridgeReplacement instanceof DirectionBridge; }catch(e){ return false; } }

function field(obj, name){
    let v = obj[name];
    if(v !== undefined) return v;
    let c = obj.getClass();
    while(c != null){
        try{
            const f = c.getDeclaredField(name);
            f.setAccessible(true);
            return f.get(obj);
        }catch(e){}
        c = c.getSuperclass();
    }
    return null;
}

function isBad(p, team){
    if(isBr(p.block)) return false;
    const t = p.tile();
    return t == null || (!Build.validPlace(p.block, team, p.x, p.y, p.rotation) && t.block() != p.block);
}

function convertChain(plans, start, phase){
    const stack = [start], seen = [];
    while(stack.length > 0){
        const p = stack.pop();
        if(seen.indexOf(p) >= 0) continue;
        seen.push(p);
        for(let i = 0; i < plans.size; i++){
            const q = plans.get(i);
            if(q === p || !(isBr(q.block))) continue;
            const pc = p.config, qc = q.config;
            const fwd = pc != null && pc.x !== undefined && q.x == p.x + pc.x && q.y == p.y + pc.y;
            const back = qc != null && qc.x !== undefined && p.x == q.x + qc.x && p.y == q.y + qc.y;
            if(fwd || back) stack.push(q);
        }
    }
    for(let i = 0; i < seen.length; i++) seen[i].block = phase;
}

function convertAdj(arr, p, phase){
    const i0 = arr.indexOf(p);
    if(i0 < 0) return;
    let n = 0;
    for(let dir = -1; dir <= 1; dir += 2){
        let k = i0 + dir;
        while(k >= 0 && k < arr.length && isBr(arr[k].block)){
            arr[k].block = phase; n++;
            k += dir;
        }
    }
    if(n > 0) log("chain converted " + n + " extra bridge plans");
}

function mergeFar(out, phase, pos, range){
    const idx = [];
    for(let i = 0; i < out.length; i++) if(out[i].block === phase) idx.push(i);
    if(idx.length < 3) return out;
    const drop = {};
    let dropped = 0, k = 0;
    while(k < idx.length - 1){
        let q = k + 1;
        while(q + 1 < idx.length && pos(out[idx[q + 1]]) - pos(out[idx[k]]) <= range) q++;
        if(q > k + 1){
            for(let t = idx[k] + 1; t < idx[q]; t++){ drop[t] = true; dropped++; }
        }
        k = q;
    }
    dbg("mergeFar phase=" + idx.length + " dropped=" + dropped);
    const res = [];
    for(let i = 0; i < out.length; i++) if(!drop[i]) res.push(out[i]);
    return res;
}

function compress(out, phase, pos, asc, range){
    const res = [];
    let removed = 0;
    let i = 0;
    while(i < out.length){
        if(out[i].block !== phase){ res.push(out[i]); i++; continue; }
        let j = i;
        while(j + 1 < out.length && out[j + 1].block === phase) j++;
        const c = out.slice(i, j + 1);
        const kept = [c[0]];
        let k = 0;
        while(k < c.length - 1){
            let n = k + 1;
            while(n + 1 < c.length && pos(c[n + 1]) - pos(c[k]) <= range) n++;
            kept.push(c[n]);
            removed += n - k - 1;
            k = n;
        }
        for(let t = 0; t < kept.length - 1; t++){
            const lo = kept[t], hi = kept[t + 1];
            const src = asc ? lo : hi, dst = asc ? hi : lo;
            const d = pos(dst) - pos(src);
            src.config = new Point2(pos === undefined ? 0 : (src.y == dst.y ? d : 0), src.y == dst.y ? 0 : d);
        }
        for(let t = 0; t < kept.length; t++) res.push(kept[t]);
        i = j + 1;
    }
    if(removed > 0) log("compressed chain, removed " + removed + " bridges");
    return res;
}

function keepJunctions(plans, blk){
    if(!(blk instanceof Conduit || blk instanceof Conveyor || blk instanceof Duct)) return 0;
    const isDir = dirBr(blk);
    const n = plans.size;
    if(n < 3) return 0;
    const first = plans.get(0), last = plans.get(n - 1);
    const horiz = first.y == last.y;
    if(!horiz && first.x != last.x) return 0;
    const pos = p => horiz ? p.x : p.y;
    const asc = pos(first) <= pos(last);
    const onJ = p => { const t = p.tile(); return t != null && isJ(t.block()); };

    const arr = [];
    for(let i = 0; i < n; i++) arr.push(plans.get(i));
    arr.sort((a, b) => pos(a) - pos(b));

    let kept = 0, moved = 0;
    const drop = [];

    for(let k = 1; k < arr.length - 1; k++){
        const p = arr[k];
        if(!(p.block instanceof Conduit || p.block instanceof Conveyor || p.block instanceof Duct) || !onJ(p)) continue;
        if(pos(p) - pos(arr[k - 1]) != 1 || pos(arr[k + 1]) - pos(p) != 1) continue;
        p.block = p.tile().block();
        kept++;
    }

    for(let k = 0; k < arr.length; k++){
        const p = arr[k];
        if(!(isBr(p.block)) || !onJ(p)) continue;
        const up = k + 1 < arr.length && pos(arr[k + 1]) - pos(p) > 1;
        const down = k > 0 && pos(p) - pos(arr[k - 1]) > 1;
        if(up == down) continue;
        const o = up ? k - 1 : k + 1;
        if(o < 0 || o >= arr.length) continue;
        const q = arr[o], partner = up ? arr[k + 1] : arr[k - 1];
        if(Math.abs(pos(q) - pos(p)) != 1 || !(q.block instanceof Conduit || q.block instanceof Conveyor || q.block instanceof Duct) || onJ(q)) continue;

        let b = p.block;
        const span = Math.abs(pos(partner) - pos(q));
        if(span > Number(b.range)){
            const ph = phaseFor(blk);
            if(ph == null || !ph.unlockedNow() || span > Number(ph.range)) continue;
            b = ph;
            convertAdj(arr, partner, ph);
        }
        q.block = b; partner.block = b;
        const lo = pos(q) < pos(partner) ? q : partner;
        const hi = lo === q ? partner : q;
        const src = asc ? lo : hi, dst = asc ? hi : lo;
        const d = pos(dst) - pos(src);
        if(!(b instanceof DirectionBridge)) src.config = new Point2(horiz ? d : 0, horiz ? 0 : d);
        drop.push(p);
        moved++;
    }

    if(drop.length > 0){
        const res = new Seq();
        for(let k = 0; k < arr.length; k++) if(drop.indexOf(arr[k]) < 0) res.add(arr[k]);
        if(!asc) res.reverse();
        plans.set(res);
    }
    if(kept + moved > 0) log("junctions kept=" + kept + " bridged-over=" + moved);
    return kept + moved;
}

function relink(plans, phase){
    const n = plans.size;
    if(n < 2) return;
    const first = plans.get(0), last = plans.get(n - 1);
    const horiz = first.y == last.y;
    if(!horiz && first.x != last.x) return;
    const pos = p => horiz ? p.x : p.y;
    const asc = pos(first) <= pos(last);
    const range = Number(phase.range);
    const arr = [];
    for(let i = 0; i < n; i++) arr.push(plans.get(i));
    arr.sort((a, b) => pos(a) - pos(b));
    if(!asc) arr.reverse();
    for(let i = 0; i < arr.length; i++){
        const p = arr[i];
        if(p.block !== phase) continue;
        const q = i + 1 < arr.length ? arr[i + 1] : null;
        if(q != null && q.block === phase && Math.abs(pos(q) - pos(p)) <= range){
            const d = pos(q) - pos(p);
            p.config = new Point2(horiz ? d : 0, horiz ? 0 : d);
        }else{
            p.config = null;
        }
    }
}

function dumpPhase(plans, phase){
    const n = plans.size;
    if(n < 2) return;
    const first = plans.get(0), last = plans.get(n - 1);
    const horiz = first.y == last.y;
    const pos = p => horiz ? p.x : p.y;
    const arr = [];
    for(let i = 0; i < n; i++) arr.push(plans.get(i));
    arr.sort((a, b) => pos(a) - pos(b));
    if(pos(first) > pos(last)) arr.reverse();
    let s = "drag-order phase bridges:";
    for(let i = 0; i < arr.length; i++){
        const p = arr[i];
        if(p.block !== phase) continue;
        const c = p.config;
        s += " [" + pos(p) + (c == null ? " no-link" : " ->" + c.x + "," + c.y) + "]";
    }
    dbg(s);
}

function upgrade(plans, phase){
    const team = Vars.player.team();
    const n = plans.size;
    if(n < 3) return 0;
    const first = plans.get(0), last = plans.get(n - 1);
    const horiz = first.y == last.y;
    if(!horiz && first.x != last.x) return 0;
    const pos = p => horiz ? p.x : p.y;
    const range = Number(phase.range);

    const arr = [];
    for(let i = 0; i < n; i++) arr.push(plans.get(i));
    arr.sort((a, b) => pos(a) - pos(b));
    const asc = pos(first) <= pos(last);

    const out = [];
    let changed = 0;
    let i = 0;
    while(i < arr.length){
        if(!isBad(arr[i], team)){ out.push(arr[i]); i++; continue; }
        let j = i;
        while(j < arr.length && isBad(arr[j], team)) j++;
        let a = out.length > 0 ? out[out.length - 1] : null;
        while(a != null && isJ(a.block)){ out.pop(); a = out.length > 0 ? out[out.length - 1] : null; }
        let jb = j;
        while(jb < arr.length && isJ(arr[jb].block)) jb++;
        const b = jb < arr.length ? arr[jb] : null;
        if(a == null || b == null || Math.abs(pos(b) - pos(a)) > range){
            for(let k = i; k < j; k++) out.push(arr[k]);
            i = j; continue;
        }
        const src = asc ? a : b, dst = asc ? b : a;
        convertAdj(arr, a, phase);
        convertAdj(arr, b, phase);
        src.block = phase; dst.block = phase;
        const dx = horiz ? pos(dst) - pos(src) : 0, dy = horiz ? 0 : pos(dst) - pos(src);
        src.config = new Point2(dx, dy);
        changed++;
        i = jb;
    }
    if(changed > 0){
        const res = new Seq();
        const comp = mergeFar(out, phase, pos, range); for(let k = 0; k < comp.length; k++) res.add(comp[k]);
        if(!asc) res.reverse();
        plans.set(res);
    }
    relink(plans, phase);
    dumpPhase(plans, phase);
    return changed;
}

Events.run(Trigger.preDraw, () => {
    try{
        const input = Vars.control.input;
        const blk = input.block;
        const phase = blk == null ? null : phaseFor(blk);
        if(phase == null) return;
        const lines = field(input, "linePlans");
        if(lines == null || lines.size < 3) return;
        keepJunctions(lines, blk);
        const d = (!phase.unlockedNow()) ? 0 : upgrade(lines, phase);
        if(d > 0) log("preview upgraded " + d + " spans, plans=" + lines.size);
    }catch(e){
        Log.err("[xn-qol] preDraw: " + e);
    }
});

Events.run(Trigger.preDraw, () => {
    try{
        const unit = Vars.player.unit();
        if(unit == null || unit.plans == null || unit.plans.size < 3) return;
        const blk = Vars.control.input.block;
        const phase = blk == null ? null : phaseFor(blk);
        if(phase == null) return;
        keepJunctions(unit.plans, blk);
        const d = (!phase.unlockedNow()) ? 0 : upgrade(unit.plans, phase);
        if(d > 0) dbg("[phase] queue upgraded " + d);
    }catch(e){
        Log.err("[xn-qol] queue: " + e);
    }
});

Events.on(ClientLoadEvent, () => {
    const Strs = Packages.arc.util.Strings;
    const M = Packages.mindustry;
    const Bar = M.ui.Bar, Pal = M.graphics.Pal;
    const fx = n => Strs.autoFixed(n, 1);
    const mk = (txt, frac) => new Bar(prov(() => txt()), prov(() => Pal.lightOrange), floatp(() => frac()));
    const swap = (cls, ok, make) => Vars.content.blocks().each(cons(b => {
        if(!(b instanceof cls) || !ok(b)) return;
        b.removeBar("heat");
        b.addBar("heat", func(e => make(b, e)));
    }));

    swap(M.world.blocks.production.HeatCrafter, b => true, (b, e) => mk(
        () => Core.bundle.format("bar.heatpercent", fx(e.heat), "" + Math.floor(e.efficiencyScale() * 100 + 0.01)),
        () => e.heat / b.heatRequirement));

    swap(M.world.blocks.defense.turrets.Turret, b => b.heatRequirement > 0, (b, e) => mk(
        () => Core.bundle.format("bar.heatpercent", fx(e.heatReq), "" + Math.floor(Math.min(e.heatReq / b.heatRequirement, b.maxHeatEfficiency) * 100)),
        () => e.heatReq / b.heatRequirement));

    swap(M.world.blocks.power.VariableReactor, b => true, (b, e) => mk(
        () => Core.bundle.format("bar.heatpercent", fx(e.heat), "" + Math.floor(Mathf.clamp(e.heat / b.maxHeat) * 100)),
        () => e.heat / b.maxHeat));
});
