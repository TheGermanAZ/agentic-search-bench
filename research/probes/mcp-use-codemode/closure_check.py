"""Can guest code reach the MCPClient (and every server's config, env and sessions) through a tool closure?"""
import adapter as A

s = A.new_session(False)
code = ("ex = [c.cell_contents for c in search_tools.__closure__ if type(c.cell_contents).__name__ == 'CodeExecutor'][0]\n"
        "cfg = ex.client.config\n"
        "print('client type:', type(ex.client).__name__)\n"
        "print('server env visible to guest:', cfg['mcpServers']['host']['env'])\n"
        "print('sessions:', sorted(ex.client.sessions))")
r = s.run(code)
print("code:\n" + code)
print("ok:", r["ok"], "error:", r["error"])
print(r["stdout"])
s.close()
