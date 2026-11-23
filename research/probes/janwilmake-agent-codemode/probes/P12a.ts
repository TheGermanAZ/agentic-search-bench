try { console.log("this.constructor:", typeof (this as any).constructor.constructor("return process")()); } catch (e) { console.log("this.constructor threw:", String(e)); }
try { console.log("sloppy this:", typeof (function(this: any){return this})().process); } catch (e) { console.log("sloppy this threw:", String(e)); }
