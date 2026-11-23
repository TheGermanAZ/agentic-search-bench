import json,sys
for line in open(sys.argv[1]):
    m=json.loads(line); t=m.get('type')
    if t=='system' and m.get('subtype')=='init':
        print('INIT', {k:m.get(k) for k in ('model','claude_code_version','permissionMode')})
    if t in('assistant','user') and isinstance(m['message']['content'],list):
        for c in m['message']['content']:
            if c.get('type')=='tool_use': print('TOOL_USE', c['input'].get('command'))
            if c.get('type')=='tool_result':
                cc=c.get('content')
                if isinstance(cc,list): cc=' '.join(x.get('text','') for x in cc)
                print('RESULT is_error=%s %r' % (c.get('is_error'), cc[:700]))
    if t=='result': print('DONE', m.get('subtype'), 'turns=',m.get('num_turns'), 'cost=',m.get('total_cost_usd'))
