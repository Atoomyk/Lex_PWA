import os
from flask import Flask, render_template, send_from_directory
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'change-me')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/login')
def login():
    return render_template('login.html')


@app.route('/sw.js')
def sw():
    return send_from_directory('static', 'sw.js')


if __name__ == '__main__':
    host = os.getenv('APP_HOST', '127.0.0.1')
    port = int(os.getenv('APP_PORT', '18081'))
    debug = os.getenv('APP_DEBUG', 'false').lower() == 'true'
    app.run(host=host, port=port, debug=debug)
