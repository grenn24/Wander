export default async ({project, text, rect, frame, media}) => {
  const p = await project({dir:'/home/user/wander-promo/project',size:'720x1280',fps:24,background:'#f4efe5'});
  const shots = await Promise.all(['describe','map','stops'].map(name=>p.add('/home/user/wander-promo/assets/'+name+'.png')));
  const art = await p.add('/home/user/wander-promo/assets/journey.webp');
  const serif=await p.add('/home/user/wander-promo/project/fonts/playfair-display-400.woff2');
  const sans=await p.add('/home/user/wander-promo/project/fonts/dm-sans-400.woff2');
  const ink='#302b24', muted='#777360', accent='#c9775e';
  const fade = dur => [{property:'opacity',keyframes:[{at:0,value:0},{at:.35,value:1},{at:dur-.3,value:1},{at:dur,value:0}]}];
  const headlines=['Start with an idea.','See your days on the map.','Find your next stop.'];
  shots.forEach((shot,i)=>{
    p.compose([
      text('Wander',{x:48,y:36,width:250,height:50,fontFamily:'Playfair Display',typography:{fontAssetId:serif.id},fontSize:35,color:ink}),
      text('0'+(i+1)+' / 03',{x:540,y:48,width:132,height:30,fontFamily:'DM Sans',typography:{fontAssetId:sans.id},fontSize:20,align:'right',color:muted}),
      frame({layout:'none',width:720,height:1180,y:96,animate:fade(4.5)},[
        text(headlines[i],{x:48,y:14,width:624,height:100,fontFamily:'Playfair Display',typography:{fontAssetId:serif.id},fontSize:46,color:ink}),
        rect({x:78,y:114,width:564,height:1046,radius:30,fill:'#e5ddcf',shadow:{x:0,y:10,blur:26,color:'#302b2424'}}),
        media({file:shot,x:88,y:124,width:544,height:1026,fit:'contain',radius:22}),
      ])
    ],{at:i*4.5,dur:4.5,name:headlines[i]});
  });
  p.compose(frame({layout:'none',width:720,height:1280,animate:fade(4.5)},[
    text('Wander',{x:60,y:235,width:600,height:135,fontFamily:'Playfair Display',typography:{fontAssetId:serif.id},fontSize:105,align:'center',color:ink}),
    media({file:art,x:150,y:385,width:420,height:282,fit:'contain',blendMode:'multiply'}),
    text('Less juggling.\nMore wandering.',{x:60,y:700,width:600,height:166,fontFamily:'Playfair Display',typography:{fontAssetId:serif.id},fontSize:56,align:'center',color:ink,lineHeight:1.2}),
    rect({x:206,y:915,width:308,height:66,radius:33,fill:accent}),
    text('Plan your next trip',{x:211,y:930,width:298,height:43,fontFamily:'DM Sans',typography:{fontAssetId:sans.id},fontSize:25,align:'center',color:'#ffffff'}),
    text('wander-travel-itinerary-planner\n.vercel.app',{x:80,y:1020,width:560,height:76,fontFamily:'DM Sans',typography:{fontAssetId:sans.id},fontSize:23,align:'center',color:muted,lineHeight:1.4}),
  ]),{at:13.5,dur:4.5,name:'Invitation'});
  for (const [i,t] of [2,6.5,11,16].entries()) await p.frame(t,'renders/check-'+i+'.png');
  await p.render('renders/silent.mp4',{bitrate:3500000,concurrency:2});
};
