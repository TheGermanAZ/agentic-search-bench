"""How much can one execution allocate before the guest aborts? Fresh tool per size, default config."""
import adapter as A

for mb in (8, 10, 12, 14, 16, 32):
    s = A.new_session(False)
    try:
        r = s.run(f'a = ["x" * 10**6 for _ in range({mb})]\nprint(len(a))')
        print(f"{mb:4} x 1 MB strings: ok={r['ok']} stdout={r['stdout'].strip()!r} error={str(r['error'])[:80]!r}")
    except RuntimeError as e:
        print(f"{mb:4} x 1 MB strings: invoke raised RuntimeError: {e}")
    s.close()
