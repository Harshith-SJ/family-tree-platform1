type Counter = { name:string; help:string; values: Map<string, number>; labelNames:string[] };
type Histogram = { name:string; help:string; buckets:number[]; counts:number[]; sum:number; count:number; labelNames:string[] };

const counters: Record<string, Counter> = {};
const histograms: Record<string, Histogram> = {};

export function counter(name:string, help:string, labelNames:string[]=[]){
  if(!counters[name]) counters[name] = { name, help, values:new Map(), labelNames };
  return {
    inc:(labels:Record<string,string>={}, val=1)=>{
      const key = counters[name].labelNames.map(l=>labels[l]||'').join('|');
      const cur = counters[name].values.get(key)||0;
      counters[name].values.set(key, cur+val);
    }
  };
}

export function histogram(name:string, help:string, buckets:number[], labelNames:string[]=[]){
  if(!histograms[name]) histograms[name] = { name, help, buckets:[...buckets].sort((a,b)=>a-b), counts:new Array(buckets.length+1).fill(0), sum:0, count:0, labelNames };
  return {
    observe:(_labels:Record<string,string>={}, val:number)=>{
      const h = histograms[name];
      let idx = h.buckets.findIndex(b=>val<=b);
      if(idx===-1) idx = h.counts.length-1; // +Inf bucket
      h.counts[idx]++;
      h.sum += val; h.count++;
    }
  };
}

export function renderPrometheus(){
  const lines:string[] = [];
  Object.values(counters).forEach(c=>{
    lines.push(`# HELP ${c.name} ${c.help}`);
    lines.push(`# TYPE ${c.name} counter`);
    if(c.values.size===0) lines.push(`${c.name} 0`);
    c.values.forEach((v,k)=>{
      if(c.labelNames.length===0) lines.push(`${c.name} ${v}`);
      else {
        const labelParts = k.split('|').map((val,i)=>`${c.labelNames[i]}="${val}"`);
        lines.push(`${c.name}{${labelParts.join(',')}} ${v}`);
      }
    });
  });
  Object.values(histograms).forEach(h=>{
    lines.push(`# HELP ${h.name} ${h.help}`);
    lines.push(`# TYPE ${h.name} histogram`);
    let cumulative = 0;
    h.buckets.forEach((b,i)=>{ cumulative += h.counts[i]; lines.push(`${h.name}_bucket{le="${b}"} ${cumulative}`); });
    cumulative += h.counts[h.counts.length-1];
    lines.push(`${h.name}_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`${h.name}_sum ${h.sum}`);
    lines.push(`${h.name}_count ${h.count}`);
  });
  return lines.join('\n');
}

// Pre-register core metrics
export const relationCounter = counter('relation_type_total','Total relations created',['relationType']);
export const mutationErrorCounter = counter('mutation_errors_total','Total mutation errors',['code']);
export const relationLatency = histogram('relation_latency_ms','/relations/add latency ms',[50,100,250,500,1000,2000]);
export const requestCounter = counter('http_requests_total','Total HTTP requests',['method','route','status']);
export const requestLatency = histogram('http_request_duration_ms','HTTP request duration ms',[25,50,100,250,500,1000,2000,5000]);
