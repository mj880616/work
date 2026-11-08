#!/usr/bin/env python3
# 화면 시험(app-e2e-check.yml)용 정적 서버. `python3 -m http.server`와 같은 파일을 같은 방식으로 내준다(읽기 전용).
#
# 바꾼 것은 접속 대기 줄(listen backlog) 하나다. 기본 http.server는 대기 줄이 5칸이라, --workers=2로 브라우저 둘이
# 앱 모듈 수백 개를 한꺼번에 받으면 줄이 넘쳐 리눅스가 새 접속(SYN)을 버린다. 브라우저는 1초·2초 뒤에야 다시 접속하므로
# 앱 시작(kptu-ui-ready)·늦게 불러오는 모듈이 가끔 2~4초씩 늦어져 5초 기다림을 넘겼다(STAB-화면시험간헐).
# 대기 줄을 넓히면 버려지는 접속이 없어진다. 시험이 기다리는 조건·시간은 바꾸지 않는다.
#
# 사용: python3 tests/app-e2e/helpers/static-server.py 8123   (저장소 루트에서 실행, 127.0.0.1에만 연다)
import functools
import http.server
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory='.')
    with Server(('127.0.0.1', port), handler) as httpd:
        httpd.serve_forever()


if __name__ == '__main__':
    main()
