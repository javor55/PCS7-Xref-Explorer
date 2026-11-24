import json,sys,os
root=os.path.dirname(os.path.abspath(__file__)); d=os.path.join(root,'src')
icons=json.load(open(d+'/icons.json'))
css=open(d+'/app.css',encoding='utf-8').read()
vendor = '/* PCS7-IO-Analyzer (github.com/javor55/PCS7-IO-Analyzer), MIT License, (c) 2026 javor55 */\n' + open(d+'/vendor/catalog.js',encoding='utf-8').read()+'\n'+open(d+'/vendor/parser.js',encoding='utf-8').read()
js='const ICONS='+json.dumps(icons)+';\n'+vendor+'\n'+''.join(open(d+'/'+f,encoding='utf-8').read()+'\n' for f in ['parse.js','hw.js','graph.js','app.js'])
h=open(d+'/shell.html',encoding='utf-8').read().replace('/*CSS*/',css).replace('/*JS*/',js.replace('</script','<\\/script'))
os.makedirs(root+'/dist',exist_ok=True); open(root+'/dist/PCS7_Xref_Explorer.html','w',encoding='utf-8').write(h); print(len(h))
