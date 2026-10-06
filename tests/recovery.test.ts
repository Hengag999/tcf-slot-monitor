import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverVancouverNotification, type RecoveryIO } from "../scripts/recover-vancouver-notification";
import type { ExamSelectorRow } from "../src/lib/examSelector";

const id = "1557016902994501632";
const header = "@everyone 🇫🇷 **温哥华 TCF Canada · 报名提醒**";
process.env.RECOVER_VANCOUVER_MESSAGE_ID = id;
process.env.DISCORD_WEBHOOK_VANCOUVER = "https://example.com/api/webhooks/123/test-token";
process.env.POSTGRES_URL = "configured-but-never-used";
const exams: ExamSelectorRow[] = Array.from({length:37}, (_,i) => ({
  id:`exam-${i}`,examKey:`exam-${i}`,legacyExamKey:`old-${i}`,examType:"TCF Canada",
  label:`TCF-Canada Future ${i}`,date:`Future ${i}`,schedule:`Future ${i}`,location:"Vancouver",
  registrationWindow:"future",registrationOpensAt:Math.floor(Date.now()/1000)+864000,
  bookingUrl:"https://example.com/exams",bookingAvailable:false,spotsLeft:10,statusClass:"es-status-opens-soon",
}));
function harness() {
  const message = {id,webhook_id:"123",channel_id:"1484040131932455003",content:`${header}\nTCF-Canada Future 0`};
  const methods: string[] = [];
  let writes = 0;
  let timeOutEdit = false;
  let corruptReadback = false;
  let conflict = false;
  const io: RecoveryIO = {
    readState:async()=>[{city:"vancouver",exam_type:"TCF Canada",slots:[]}],
    listExams:async()=>exams,
    compareAndSet:async()=>{writes++;return !conflict;},
    fetchImpl:(async(_url,init)=>{
      const method=init?.method??"GET";methods.push(method);assert.ok(init?.signal);
      if(method==="PATCH") {
        const body=JSON.parse(String(init?.body));assert.deepEqual(body.allowed_mentions,{parse:[]});
        message.content=body.content;
        if(timeOutEdit) throw new Error("response lost");
      }
      const result={...message,content:corruptReadback&&methods.length>1?"incomplete":message.content};
      return new Response(JSON.stringify(result),{status:200});
    }) as typeof fetch,
  };
  return {io,message,methods,get writes(){return writes;},timeout:()=>{timeOutEdit=true;},corrupt:()=>{corruptReadback=true;},setConflict:(v:boolean)=>{conflict=v;}};
}
test("wrong target stops without editing or writing state",async()=>{
  const h=harness();h.message.channel_id="wrong";
  await assert.rejects(recoverVancouverNotification(h.io),/does not match/);
  assert.deepEqual(h.methods,["GET"]);assert.equal(h.writes,0);
});
test("lost PATCH response is safely reconciled by exact readback without a new POST",async()=>{
  const h=harness();h.timeout();await recoverVancouverNotification(h.io);
  assert.deepEqual(h.methods,["GET","PATCH","GET"]);assert.equal(h.writes,1);
});
test("incomplete readback never advances state",async()=>{
  const h=harness();h.corrupt();await assert.rejects(recoverVancouverNotification(h.io),/not verified/);
  assert.equal(h.writes,0);
});
test("state conflict is not overwritten and compact-message recovery is repeatable",async()=>{
  const h=harness();h.setConflict(true);
  await assert.rejects(recoverVancouverNotification(h.io),/concurrently/);
  assert.doesNotMatch(h.message.content,/TCF-Canada Future 0/);
  h.setConflict(false);await recoverVancouverNotification(h.io);
  assert.equal(h.writes,2);assert.ok(!h.methods.includes("POST"));
});
test("already-reconciled tracking needs no edit or write",async()=>{
  const h=harness();h.io.readState=async()=>[{city:"vancouver",exam_type:"TCF Canada",slots:exams.map(ex=>({examKey:ex.examKey,label:ex.label,registrationOpensAt:ex.registrationOpensAt,firedReminders:["new"]}))}];
  await recoverVancouverNotification(h.io);assert.deepEqual(h.methods,["GET"]);assert.equal(h.writes,0);
});
