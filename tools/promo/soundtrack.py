import math,wave,struct
rate=44100; duration=18
chords=[(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]
with wave.open('/home/user/wander-promo/bed.wav','w') as w:
 w.setparams((1,2,rate,0,'NONE','not compressed'))
 buf=bytearray()
 for i in range(rate*duration):
  t=i/rate; out=0
  for j,chord in enumerate(chords):
   age=t-j*4.5
   if 0<=age<6:
    env=min(age/.5,1)*math.exp(-age*.48)*min((6-age)/.8,1)
    out+=sum(math.sin(2*math.pi*f*2*t)+.12*math.sin(2*math.pi*f*4*t) for f in chord)*env*.037
  out*=min(t/.7,1,max(0,(duration-t)/1.2))
  buf+=struct.pack('<h',int(max(-1,min(1,out))*32767))
 w.writeframes(buf)

