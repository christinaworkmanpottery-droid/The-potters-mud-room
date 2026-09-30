// Phase 2A read-only Piece history. No inference, repair, backfill, or mutation.
function tableExists(db,name){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)}
function unavailable(){const e=new Error('Record unavailable');e.code='QL_RECORD_UNAVAILABLE';e.status=404;return e}
function firstDate(row,fields){for(const f of fields){const v=row&&row[f];if(v!==null&&v!==undefined&&String(v).trim())return String(v)}return null}
function entry(recordType,sourceRecordId,values,o={}){
 const recordedAt=o.recordedAt||null,relationshipDate=o.relationshipDate||null;
 return {recordType,sourceRecordId,recordedAt,relationshipDate,undated:!recordedAt&&!relationshipDate,manualLabel:o.manualLabel||null,
  relationship:{source:o.source||'legacy-direct',sourceId:o.relationshipId||sourceRecordId,targetId:sourceRecordId},values};
}
function order(items){const rank={sale:0,firing:1,'test-tile':2,pricing:3,'piece-photo':4,'glaze-layer':5,clay:6};
 return items.slice().sort((a,b)=>{const ad=a.recordedAt||a.relationshipDate,bd=b.recordedAt||b.relationshipDate;
  if(ad&&bd&&ad!==bd)return bd.localeCompare(ad);if(ad&&!bd)return -1;if(!ad&&bd)return 1;
  return (rank[a.recordType]??99)-(rank[b.recordType]??99)||String(a.sourceRecordId).localeCompare(String(b.sourceRecordId));});}
function createPieceHistoryService(db){
 function get({userId,pieceId,testTilesAccess = 'available'}){
  if(!userId||!pieceId)throw unavailable();
  const piece=db.prepare('SELECT * FROM pieces WHERE id=? AND user_id=?').get(pieceId,userId);if(!piece)throw unavailable();
  const clayRow=piece.clay_body_id?db.prepare('SELECT * FROM clay_bodies WHERE id=? AND user_id=?').get(piece.clay_body_id,userId):null;
  const clay=clayRow?entry('clay',clayRow.id,clayRow,{recordedAt:firstDate(clayRow,['created_at'])}):null;

  const glazeLayers=db.prepare(`SELECT pg.*,g.id linked_id,g.name linked_name,g.brand linked_brand,g.glaze_type linked_type,g.created_at linked_created
   FROM piece_glazes pg JOIN pieces p ON p.id=pg.piece_id AND p.user_id=?
   LEFT JOIN glazes g ON g.id=pg.glaze_id
   WHERE pg.piece_id=? AND (pg.glaze_id IS NULL OR g.user_id=?) ORDER BY pg.layer_order,pg.id`).all(userId,pieceId,userId).map(r=>{
    const layer={id:r.id,piece_id:r.piece_id,glaze_id:r.glaze_id,coats:r.coats,application_method:r.application_method,layer_order:r.layer_order,notes:r.notes,custom_name:r.custom_name};
    const glaze=r.glaze_id&&r.linked_id?{id:r.glaze_id,name:r.linked_name,brand:r.linked_brand,glaze_type:r.linked_type,created_at:r.linked_created}:null;
    return entry('glaze-layer',r.id,{layer,glaze},{manualLabel:r.custom_name||null,source:r.glaze_id?'legacy-direct':'manual'});
  });

  const qlf=tableExists(db,'ql_piece_firings')?db.prepare('SELECT id,firing_id,created_at FROM ql_piece_firings WHERE user_id=? AND piece_id=? ORDER BY created_at,id').all(userId,pieceId):[];
  const qlfById=new Map(qlf.map(x=>[x.firing_id,x])), firingById=new Map();
  for(const r of db.prepare('SELECT * FROM firing_logs WHERE piece_id=? AND user_id=?').all(pieceId,userId))firingById.set(r.id,{r,legacy:true,q:qlfById.get(r.id)||null});
  for(const q of qlf){if(firingById.has(q.firing_id))continue;const r=db.prepare('SELECT * FROM firing_logs WHERE id=? AND user_id=?').get(q.firing_id,userId);if(r)firingById.set(r.id,{r,legacy:false,q})}
  const firings=[...firingById.values()].map(({r,legacy,q})=>entry('firing',r.id,r,{recordedAt:firstDate(r,['date','created_at']),relationshipDate:q?.created_at||null,source:legacy&&q?'legacy+ql':legacy?'legacy':'ql',relationshipId:q?.id||r.id}));

  const testTiles=[];if(testTilesAccess === 'available' && tableExists(db,'ql_piece_test_tiles'))for(const q of db.prepare('SELECT id,test_tile_id,created_at FROM ql_piece_test_tiles WHERE user_id=? AND piece_id=? ORDER BY created_at,id').all(userId,pieceId)){
   const r=db.prepare('SELECT * FROM test_tiles WHERE id=? AND user_id=?').get(q.test_tile_id,userId);if(r)testTiles.push(entry('test-tile',r.id,r,{recordedAt:firstDate(r,['created_at']),relationshipDate:q.created_at||null,manualLabel:r.name||r.glaze_name||r.clay_name||null,source:'ql',relationshipId:q.id}));}
  const pricing=[];if(tableExists(db,'ql_piece_pricing'))for(const q of db.prepare('SELECT id,pricing_id,created_at FROM ql_piece_pricing WHERE user_id=? AND piece_id=? ORDER BY created_at,id').all(userId,pieceId)){
   const r=db.prepare('SELECT * FROM pricing_calculations WHERE id=? AND user_id=?').get(q.pricing_id,userId);if(r)pricing.push(entry('pricing',r.id,r,{recordedAt:firstDate(r,['created_at']),relationshipDate:q.created_at||null,manualLabel:r.name||null,source:'ql',relationshipId:q.id}));}

  const sales=db.prepare('SELECT * FROM sales WHERE piece_id=? AND user_id=? ORDER BY id').all(pieceId,userId).map(r=>{const v={...r};
   if(v.contact_id&&tableExists(db,'contacts')&&!db.prepare('SELECT 1 FROM contacts WHERE id=? AND user_id=?').get(v.contact_id,userId))v.contact_id=null;
   return entry('sale',v.id,v,{recordedAt:firstDate(v,['date','created_at'])});});
  const photos=db.prepare('SELECT pp.* FROM piece_photos pp JOIN pieces p ON p.id=pp.piece_id AND p.user_id=? WHERE pp.piece_id=? ORDER BY pp.sort_order,pp.id').all(userId,pieceId)
   .map(r=>entry('piece-photo',r.id,r,{recordedAt:firstDate(r,['created_at']),manualLabel:r.stage||r.original_name||null}));

  const history=order([...(clay?[clay]:[]),...glazeLayers,...firings,...testTiles,...pricing,...sales,...photos]);
  return {piece:entry('piece',piece.id,piece,{recordedAt:firstDate(piece,['date_started','created_at']),source:'piece'}),clay,glazeLayers,firings,testTiles,testTilesAccess,pricing,sales,photos,history};
 }
 return Object.freeze({get});
}
module.exports={createPieceHistoryService,order};
